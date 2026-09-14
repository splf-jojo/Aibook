import base64
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app import storage_sync
from app.database import engine
from app.main import app


def account(client):
    result = client.post('/api/auth/register', json={'username': 'sync-' + uuid4().hex[:16], 'password': 'sync-test-password'})
    assert result.status_code == 201
    headers = {'Authorization': 'Bearer ' + result.json()['access_token']}
    return headers, client.get('/api/auth/me', headers=headers).json()['id']


def voice(owner, size=30):
    record_id, file_id = str(uuid4()), str(uuid4())
    filename = file_id + '.m4a'
    return {'baseRevision': 0, 'record': {
        'id': record_id, 'ownerID': owner, 'title': 'Voice', 'noteTitle': '', 'createdAt': 100,
        'status': 'complete', 'transcriptionStatus': 'complete',
        'clips': [{'id': file_id, 'fileName': filename, 'duration': 1}], 'transcript': []},
        'audio': [{'fileName': filename, 'data': base64.b64encode(b'a' * size).decode()}]}


def test_revision_required_conflict_and_stable_create_id():
    with TestClient(app) as client:
        headers, _ = account(client)
        body = {'id': str(uuid4()), 'title': 'Local', 'content': {'pages': [{'id': 'p', 'elements': []}]}}
        first = client.post('/api/canvases', headers=headers, json=body)
        assert first.status_code == 201
        route = '/api/canvases/' + first.json()['id']
        assert first.json()['revision'] == 1
        assert client.post('/api/canvases', headers=headers, json=body).json()['id'] == first.json()['id']
        assert len(client.get('/api/canvases', headers=headers).json()) == 1
        assert client.patch(route, headers=headers, json={'title': 'Unsafe'}).status_code == 428
        assert client.patch(route, headers=headers, json={'title': 'Device A', 'baseRevision': 1}).json()['revision'] == 2
        assert client.patch(route, headers=headers, json={'title': 'Device B', 'baseRevision': 1}).status_code == 409
        assert client.delete(route, headers=headers, params={'baseRevision': 1}).status_code == 409
        assert client.get(route, headers=headers).json()['title'] == 'Device A'
        assert client.post('/api/canvases', headers=headers, json=body).status_code == 409
        assert client.delete(route, headers=headers, params={'baseRevision': 2}).status_code == 204


def test_shared_quota_boundary_replacement_rejection_and_release(monkeypatch):
    with TestClient(app) as client:
        headers, owner = account(client)
        assert client.get('/api/subscription').status_code == 401
        assert client.get('/api/subscription', headers=headers).json() == {'plan': 'Free', 'usedBytes': 0, 'limitBytes': 50_000_000}
        note = client.post('/api/canvases', headers=headers, json={'title': 'Note'}).json()
        initial = client.get('/api/subscription', headers=headers).json()['usedBytes']
        payload = voice(owner)
        size = storage_sync.json_bytes(payload['record']) + 30
        monkeypatch.setattr(storage_sync, 'FREE_STORAGE_BYTES', initial + size)
        route = '/api/voice-records/' + payload['record']['id']
        assert client.put(route, headers=headers, json=payload).status_code == 200
        usage = client.get('/api/subscription', headers=headers).json()
        assert usage['usedBytes'] == usage['limitBytes']
        # A duplicate response and a same-size replacement use no extra space.
        assert client.put(route, headers=headers, json=payload).json()['revision'] == 1
        payload['baseRevision'] = 1
        payload['record']['title'] = 'Other'
        assert client.put(route, headers=headers, json=payload).json()['revision'] == 2
        rejected = client.post('/api/canvases', headers=headers, json={'title': 'Too much'})
        assert rejected.status_code == 413
        assert rejected.json()['detail']['code'] == 'storage_quota_exceeded'
        note_route = '/api/canvases/' + note['id']
        assert client.patch(note_route, headers=headers, json={'baseRevision': 1, 'title': 'Longer title'}).status_code == 413
        assert client.get(note_route, headers=headers).json()['revision'] == 1
        assert client.get(note_route, headers=headers).json()['title'] == 'Note'
        # Grandfathered accounts above quota can still read, shrink and delete.
        monkeypatch.setattr(storage_sync, 'FREE_STORAGE_BYTES', 1)
        assert client.get(note_route, headers=headers).status_code == 200
        assert client.patch(note_route, headers=headers, json={'baseRevision': 1, 'title': 'N'}).status_code == 200
        assert client.delete(route, headers=headers, params={'baseRevision': 2}).status_code == 204
        assert client.delete(note_route, headers=headers, params={'baseRevision': 2}).status_code == 204
        assert client.get('/api/subscription', headers=headers).json()['usedBytes'] == 0


def test_voice_is_separate_private_and_conflict_safe():
    with TestClient(app) as client:
        headers, owner = account(client)
        other, _ = account(client)
        payload = voice(owner)
        route = '/api/voice-records/' + payload['record']['id']
        assert client.put(route, headers=headers, json=payload).status_code == 200
        assert client.get('/api/canvases', headers=headers).json() == []
        listing = client.get('/api/voice-records', headers=headers).json()
        assert len(listing) == 1 and 'audio' not in listing[0]
        assert client.get(route, headers=other).status_code == 404
        assert client.delete(route, headers=other, params={'baseRevision': 1}).status_code == 404
        assert client.get('/api/voice-records', headers=other).json() == []
        assert client.get(route, headers=headers).json()['audio'] == payload['audio']
        payload['baseRevision'] = 1
        payload['record']['title'] = 'First device'
        assert client.put(route, headers=headers, json=payload).json()['revision'] == 2
        payload['record']['title'] = 'Stale device'
        assert client.put(route, headers=headers, json=payload).status_code == 409
        assert client.get(route, headers=headers).json()['record']['title'] == 'First device'
        assert client.delete(route, headers=headers, params={'baseRevision': 1}).status_code == 409


@pytest.mark.parametrize('corruption', ['missing_id', 'bad_audio', 'missing_clip', 'foreign_owner'])
def test_invalid_voice_upload_does_not_consume_storage(corruption):
    with TestClient(app) as client:
        headers, owner = account(client)
        payload = voice(owner)
        route = '/api/voice-records/' + payload['record']['id']
        if corruption == 'missing_id':
            payload['record'].pop('id')
        elif corruption == 'bad_audio':
            payload['audio'][0]['data'] = 'not-base64!'
        elif corruption == 'missing_clip':
            payload['audio'] = []
        else:
            payload['record']['ownerID'] = str(uuid4())
        assert client.put(route, headers=headers, json=payload).status_code == 422
        assert client.get('/api/subscription', headers=headers).json()['usedBytes'] == 0
        assert client.get('/api/voice-records', headers=headers).json() == []


@pytest.mark.skipif(engine.dialect.name != 'postgresql', reason='Row locking requires PostgreSQL')
def test_concurrent_uploads_cannot_exceed_account_quota(monkeypatch):
    with TestClient(app) as client:
        headers, owner = account(client)
        first, second = voice(owner, 1000), voice(owner, 1000)
        limit = max(storage_sync.json_bytes(p['record']) + 1000 for p in (first, second))
        monkeypatch.setattr(storage_sync, 'FREE_STORAGE_BYTES', limit)
        def upload(payload):
            return client.put('/api/voice-records/' + payload['record']['id'], headers=headers, json=payload).status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            assert sorted(pool.map(upload, [first, second])) == [200, 413]
        assert client.get('/api/subscription', headers=headers).json()['usedBytes'] <= limit


@pytest.mark.skipif(engine.dialect.name != 'postgresql', reason='Row locking requires PostgreSQL')
def test_concurrent_updates_accept_exactly_one_revision():
    with TestClient(app) as client:
        headers, _ = account(client)
        note = client.post('/api/canvases', headers=headers, json={'title': 'Original'}).json()
        route = '/api/canvases/' + note['id']
        def update(title):
            return client.patch(route, headers=headers, json={'baseRevision': 1, 'title': title}).status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            assert sorted(pool.map(update, ['Device A', 'Device B'])) == [200, 409]
        assert client.get(route, headers=headers).json()['revision'] == 2
