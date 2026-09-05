import base64
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest
from pydantic import ValidationError

from app.main import app
from app.schemas import CanvasContent


def register(client):
    response = client.post('/api/auth/register', json={'username': f'groups-{uuid4().hex[:12]}', 'password': 'test-groups-pass'})
    assert response.status_code == 201
    return {'Authorization': f'Bearer {response.json()["access_token"]}'}


def test_group_lifecycle_and_note_membership_are_account_scoped():
    with TestClient(app) as client:
        owner, outsider = register(client), register(client)
        assert client.get('/api/note-groups').status_code == 401
        assert client.post('/api/note-groups', headers=owner, json={'name': '  '}).status_code == 422
        response = client.post('/api/note-groups', headers=owner, json={'name': '  Mathematics  '})
        assert response.status_code == 201
        group = response.json()
        assert group['name'] == 'Mathematics'
        route = f'/api/note-groups/{group["id"]}'
        assert client.get('/api/note-groups', headers=outsider).json() == []
        assert client.patch(route, headers=outsider, json={'name': 'Stolen'}).status_code == 404
        assert client.delete(route, headers=outsider).status_code == 404
        assert client.post('/api/canvases', headers=outsider, json={'title': 'Invalid', 'groupId': group['id']}).status_code == 404
        assert client.patch(route, headers=owner, json={'name': 'Physics'}).json()['name'] == 'Physics'

        created = client.post('/api/canvases', headers=owner, json={'title': 'Lesson', 'groupId': group['id']})
        assert created.status_code == 201
        note = created.json()
        note_route = f'/api/canvases/{note["id"]}'
        assert note['groupId'] == group['id']
        # Old clients omit groupId in content/title saves; membership must survive.
        assert client.patch(note_route, headers=owner, json={'title': 'Renamed', 'content': note['content']}).json()['groupId'] == group['id']
        moved = client.patch(note_route, headers=owner, json={'groupId': None})
        assert moved.status_code == 200 and moved.json()['groupId'] is None
        assert client.patch(note_route, headers=owner, json={'groupId': group['id']}).status_code == 200
        foreign_group = client.post('/api/note-groups', headers=outsider, json={'name': 'Private'}).json()
        assert client.patch(note_route, headers=owner, json={'groupId': foreign_group['id']}).status_code == 404
        assert client.patch(note_route, headers=outsider, json={'groupId': foreign_group['id']}).status_code == 404
        assert client.get('/api/canvases', headers=owner).json()[0]['groupId'] == group['id']

        assert client.delete(route, headers=owner).status_code == 204
        kept = client.get(note_route, headers=owner).json()
        assert kept['groupId'] is None
        assert kept['title'] == 'Renamed' and kept['content'] == note['content']
        assert client.get('/api/note-groups', headers=owner).json() == []
        assert client.patch(note_route, headers=owner, json={'groupId': group['id']}).status_code == 404


def test_pdf_background_survives_ink_edits_move_and_group_deletion():
    pdf = base64.b64encode(b'%PDF-1.4\nfixture\n%%EOF').decode()
    content = {'schemaVersion': 2, 'pdfData': pdf, 'pages': [
        {'id': 'pdf-page-1', 'pdfPageIndex': 0, 'elements': []},
        {'id': 'pdf-page-2', 'pdfPageIndex': 1, 'elements': []},
        {'id': 'blank', 'elements': []},
    ]}
    stroke = {'id': 'ink', 'kind': 'stroke', 'mode': 'draw', 'points': [10, 20, 11, 21], 'strokeWidth': 2}
    with TestClient(app) as client:
        headers = register(client)
        group = client.post('/api/note-groups', headers=headers, json={'name': 'PDFs'}).json()
        response = client.post('/api/canvases', headers=headers, json={'title': 'PDF', 'content': content})
        assert response.status_code == 201
        note = response.json()
        route = f'/api/canvases/{note["id"]}'
        # A schema-2 client that predates PDF support must not erase backgrounds.
        old_content = {'schemaVersion': 2, 'pages': [{'id': page['id'], 'elements': [stroke]} for page in content['pages']]}
        saved = client.patch(route, headers=headers, json={'content': old_content}).json()
        assert saved['content']['pdfData'] == pdf
        assert [page['pdfPageIndex'] for page in saved['content']['pages']] == [0, 1, None]
        assert all(page['elements'][0]['points'] == stroke['points'] for page in saved['content']['pages'])
        client.patch(route, headers=headers, json={'groupId': group['id']})
        assert client.delete(f'/api/note-groups/{group["id"]}', headers=headers).status_code == 204
        assert client.get(route, headers=headers).json()['content'] == saved['content']
        summaries = client.get('/api/canvases', headers=headers).json()
        assert summaries[0]['elementCount'] == 3
        assert 'pdfData' not in str(summaries) and 'content' not in summaries[0]


@pytest.mark.parametrize('size,accepted', [(4_999_999, True), (5_000_000, True), (5_000_001, False)])
def test_pdf_decoded_byte_limit(size, accepted):
    encoded = base64.b64encode(b'%PDF-' + b' ' * (size - 5)).decode()
    if accepted:
        assert CanvasContent.model_validate({'pdfData': encoded}).pdf_data == encoded
    else:
        with pytest.raises(ValidationError):
            CanvasContent.model_validate({'pdfData': encoded})


@pytest.mark.parametrize('content', [
    {'pdfData': 'not-base64'}, {'pdfData': base64.b64encode(b'not a PDF').decode()},
    {'pages': [{'pdfPageIndex': 0}]}, {'pdfData': None, 'pages': [{'pdfPageIndex': -1}]},
])
def test_invalid_pdf_metadata_is_rejected(content):
    with pytest.raises(ValidationError):
        CanvasContent.model_validate(content)
