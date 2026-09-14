"""Run only against an isolated PostgreSQL database at revision 20260910_0007."""
import asyncio
import json
import os
import subprocess
from uuid import uuid4

import pytest
from sqlalchemy import text

from app.database import engine
from app.storage_sync import json_bytes


@pytest.mark.skipif(os.getenv('TEST_SYNC_MIGRATION') != '1', reason='Requires isolated pre-migration database')
def test_existing_canvas_is_preserved_and_counted():
    user_id, note_id = str(uuid4()), str(uuid4())
    title = 'Старая заметка'
    content = {'schemaVersion': 2, 'pages': [{'id': 'old-page', 'elements': []}]}

    async def seed():
        async with engine.begin() as connection:
            assert await connection.scalar(text('SELECT version_num FROM alembic_version')) == '20260910_0007'
            await connection.execute(text('INSERT INTO users (id,username,password_hash,created_at) VALUES (:id,:name,:hash,now())'),
                                     {'id': user_id, 'name': 'migration-' + user_id[:8], 'hash': 'test-only'})
            await connection.execute(text('INSERT INTO canvases (id,user_id,title,content,created_at,updated_at) '
                                          'VALUES (:id,:owner,:title,CAST(:content AS json),now(),now())'),
                                     {'id': note_id, 'owner': user_id, 'title': title, 'content': json.dumps(content)})
        await engine.dispose()

    async def verify():
        async with engine.connect() as connection:
            row = (await connection.execute(text('SELECT title,content,revision,size_bytes FROM canvases WHERE id=:id'), {'id': note_id})).one()
            assert row.title == title and row.content == content
            assert row.revision == 1
            assert row.size_bytes == json_bytes(content) + len(title.encode('utf-8'))
        await engine.dispose()

    asyncio.run(seed())
    subprocess.run(['alembic', 'upgrade', 'head'], check=True)
    asyncio.run(verify())
