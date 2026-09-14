"""Selective sync: one current revision, atomic account quota, separate audio storage."""
import base64
import binascii
import json
import math
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import Field, model_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .database import get_session
from .dependencies import get_current_user
from .models import CanvasDocument, User, VoiceClip, VoiceDocument, utc_now
from .schemas import CamelModel

router = APIRouter()
FREE_STORAGE_BYTES = 50_000_000


def json_bytes(value) -> int:
    return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


async def lock_account(session: AsyncSession, user: User):
    # Every quota-changing write takes this lock BEFORE reading its document.
    # PostgreSQL serializes simultaneous uploads from different devices/services.
    await session.scalar(select(User.id).where(User.id == user.id).with_for_update())


async def used_bytes(session: AsyncSession, user: User) -> int:
    totals = [select(func.coalesce(func.sum(model.size_bytes), 0)).where(model.user_id == user.id).scalar_subquery()
              for model in (CanvasDocument, VoiceDocument)]
    # One statement gives the subscription meter a consistent database snapshot too.
    return int(await session.scalar(select(totals[0] + totals[1])))


async def check_quota(session: AsyncSession, user: User, old_size: int, new_size: int):
    used = await used_bytes(session, user)
    if new_size > old_size and used - old_size + new_size > FREE_STORAGE_BYTES:
        raise HTTPException(413, detail={"code": "storage_quota_exceeded",
            "message": "Лимит Free 50 МБ исчерпан. Данные остались на iPad. Освободите место на сервере и повторите синхронизацию.",
            "usedBytes": used, "limitBytes": FREE_STORAGE_BYTES})


def check_revision(base: int | None, current: int):
    if base is None:
        raise HTTPException(428, detail={"code": "revision_required",
            "message": "Для сохранения нужна серверная ревизия. Обновите приложение.", "revision": current})
    if base != current:
        raise HTTPException(409, detail={"code": "revision_conflict",
            "message": "Запись изменена на другом устройстве. Локальные правки сохранены. Выберите «Сохранить обе версии».",
            "revision": current})


@router.get("/api/subscription")
async def subscription(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    return {"plan": "Free", "usedBytes": await used_bytes(session, user), "limitBytes": FREE_STORAGE_BYTES}


class AudioUpload(CamelModel):
    file_name: str = Field(pattern=r"^[0-9a-fA-F-]{36}\.(caf|m4a)$")
    data: str = Field(max_length=66_666_668)


class VoiceUpload(CamelModel):
    base_revision: int = Field(ge=0)
    record: dict
    audio: list[AudioUpload] = Field(max_length=1000)

    @model_validator(mode="after")
    def validate_manifest(self):
        # Preserve transcript metadata, but reject unusable file references.
        try:
            UUID(self.record["id"])
            for key in ("ownerID", "title", "noteTitle", "status", "transcriptionStatus"):
                if not isinstance(self.record.get(key), str):
                    raise ValueError("Invalid recording metadata")
            if len(self.record["title"]) > 160:
                raise ValueError("Invalid recording title")
            created = self.record.get("createdAt")
            if not isinstance(created, (float, int)) or not math.isfinite(created):
                raise ValueError("Invalid recording date")
            clips = self.record["clips"]
            if not isinstance(clips, list) or not isinstance(self.record["transcript"], list):
                raise ValueError("Invalid recording manifest")
            for clip in clips:
                UUID(clip["id"])
                if not math.isfinite(clip["duration"]) or clip["duration"] < 0:
                    raise ValueError("Invalid audio duration")
            for span in self.record["transcript"]:
                UUID(span["id"])
                if (not math.isfinite(span["start"]) or not math.isfinite(span["end"])
                    or span["start"] < 0 or span["end"] < span["start"]
                    or not isinstance(span["text"], str) or not isinstance(span["isFinal"], bool)):
                    raise ValueError("Invalid transcript span")
            names = [clip["fileName"] for clip in clips]
            for name in names:
                UUID(name[:-4])
            if len(set(names)) != len(names) or set(names) != {clip.file_name for clip in self.audio} or len(names) != len(self.audio):
                raise ValueError("Audio must exactly match the recording manifest")
        except (KeyError, TypeError, AttributeError) as error:
            raise ValueError("Invalid recording manifest") from error
        return self


def voice_response(document: VoiceDocument, *, audio: bool):
    result = {"id": document.id, "revision": document.revision, "record": document.record}
    if audio:
        result["audio"] = [{"fileName": clip.file_name, "data": base64.b64encode(clip.data).decode("ascii")}
                           for clip in document.clips]
    return result


async def owned_voice(record_id: str, user: User, session: AsyncSession):
    document = await session.get(VoiceDocument, record_id)
    if document is None or document.user_id != user.id:
        raise HTTPException(404, detail="Recording not found")
    return document


@router.get("/api/voice-records")
async def list_voice(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    # Do not pull audio blobs into the library listing.
    rows = await session.execute(select(VoiceDocument.id, VoiceDocument.revision, VoiceDocument.record)
                                .where(VoiceDocument.user_id == user.id))
    return [{"id": row.id, "revision": row.revision, "record": row.record} for row in rows]


@router.get("/api/voice-records/{record_id}")
async def get_voice(record_id: UUID, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    return voice_response(await owned_voice(str(record_id), user, session), audio=True)


@router.put("/api/voice-records/{record_id}")
async def put_voice(record_id: UUID, payload: VoiceUpload, user: User = Depends(get_current_user),
                    session: AsyncSession = Depends(get_session)):
    record = dict(payload.record)
    if UUID(record["id"]) != record_id or record.get("ownerID") != user.id:
        raise HTTPException(422, detail="Recording identity does not match the signed-in account")
    # Sync state belongs to each device, never trust or replicate it.
    for key in ("syncEnabled", "serverRevision", "syncDirty", "syncError", "changeID"):
        record.pop(key, None)
    try:
        audio = {clip.file_name: base64.b64decode(clip.data, validate=True) for clip in payload.audio}
    except (ValueError, binascii.Error) as error:
        raise HTTPException(422, detail="Invalid audio encoding") from error
    size = json_bytes(record) + sum(len(data) for data in audio.values())
    await lock_account(session, user)
    document = await session.get(VoiceDocument, str(record_id))
    if document is not None and document.user_id != user.id:
        raise HTTPException(404)
    if document is not None and document.record == record and {c.file_name: c.data for c in document.clips} == audio:
        return voice_response(document, audio=False)  # Retry after a lost acknowledgement.
    check_revision(payload.base_revision, document.revision if document else 0)
    await check_quota(session, user, document.size_bytes if document else 0, size)
    if document is None:
        document = VoiceDocument(id=str(record_id), user_id=user.id, revision=0)
        session.add(document)
    document.record = record
    document.size_bytes = size
    document.revision += 1
    document.updated_at = utc_now()
    existing = {clip.file_name: clip for clip in document.clips}
    document.clips = [existing[name] if name in existing else VoiceClip(file_name=name, data=data)
                      for name, data in audio.items()]
    for clip in document.clips:
        clip.data = audio[clip.file_name]
    await session.commit()
    return voice_response(document, audio=False)


@router.delete("/api/voice-records/{record_id}", status_code=204)
async def delete_voice(record_id: UUID, base_revision: int | None = Query(None, alias="baseRevision", ge=1),
                       user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    await lock_account(session, user)
    document = await owned_voice(str(record_id), user, session)
    check_revision(base_revision, document.revision)
    await session.delete(document)
    await session.commit()
    return Response(status_code=204)
