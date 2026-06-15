/**
 * Smoke test for the V3 Flask pack pair.
 *
 * Spec: V3 Pack Migration Batch (Task Group 4)
 *
 * Migrated from direct `extractPythonIR` + `runFlaskAdapter` invocation to
 * the V3 pack shape: `pythonLangPack.extract` + `flaskFrameworkPack.adapt`.
 * All assertions preserved verbatim — only the invocation shape changes.
 */
import { pythonLangPack } from '../services/extensionPacks/languagePacks/pythonLangPack';
import { flaskFrameworkPack } from '../services/extensionPacks/frameworkPacks/flaskFrameworkPack';
import type { TechHints } from '../services/extensionPacks';

const FLASK_HINTS: TechHints = {
  '0': { language: 'Python' },
  '1': { technology: 'Flask' },
};

const ROUTES_SRC = `
from flask import Flask

app = Flask(__name__)

@app.route('/')
def index():
    return 'hello'

@app.route('/posts', methods=['GET', 'POST'])
def posts():
    return []

@app.get('/users/<id>')
def get_user(id):
    return None

@app.post('/users')
def create_user():
    return None
`;

const MODELS_SRC = `
from myapp import db

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(64))
    email = db.Column(db.String(120))
    posts = db.relationship('Post', backref='author')

class Post(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    body = db.Column(db.String(140))
`;

const SCHEMAS_SRC = `
from marshmallow import Schema, fields

class UserSchema(Schema):
    id = fields.Integer()
    username = fields.String()
    email = fields.Email()
`;

function runV3Pipeline(files: Map<string, string>, runId: string) {
  const irFiles = pythonLangPack.extract(files, FLASK_HINTS);
  return flaskFrameworkPack.adapt(irFiles, runId, FLASK_HINTS);
}

describe('Flask V3 pack pair smoke tests', () => {
  const files = new Map<string, string>([
    ['app/routes.py', ROUTES_SRC],
    ['app/models.py', MODELS_SRC],
    ['app/schemas.py', SCHEMAS_SRC],
  ]);

  it('emits endpoint for @app.route and @app.get/@app.post', () => {
    const c = runV3Pipeline(files, 'fl-smoke');
    const eps = c.filter((x) => x.candidateType === 'endpoints').map((e) => e.name).sort();
    expect(eps).toContain('GET /');
    expect(eps).toContain('GET /posts'); // methods list starts with GET
    expect(eps).toContain('GET /users/<id>');
    expect(eps).toContain('POST /users');
  });

  it('emits physical_entity for SQLAlchemy Model classes', () => {
    const c = runV3Pipeline(files, 'fl-smoke');
    const names = c.filter((x) => x.candidateType === 'physical_data_entities').map((e) => e.name).sort();
    expect(names).toEqual(['Post', 'User']);
  });

  it('emits physical_attribute for db.Column fields', () => {
    const c = runV3Pipeline(files, 'fl-smoke');
    const attrs = c.filter((x) => x.candidateType === 'physical_data_attributes').map((a) => a.name).sort();
    expect(attrs).toContain('id');
    expect(attrs).toContain('username');
    expect(attrs).toContain('body');
  });

  it('emits entity_relationship for db.relationship', () => {
    const c = runV3Pipeline(files, 'fl-smoke');
    const rels = c.filter((x) => x.candidateType === 'logical_data_entity_relationships').map((r) => r.name);
    expect(rels).toContain('User → Post');
  });

  it('emits logical_entity for Marshmallow Schema', () => {
    const c = runV3Pipeline(files, 'fl-smoke');
    const logs = c.filter((x) => x.candidateType === 'logical_data_entities').map((l) => l.name);
    expect(logs).toContain('UserSchema');
  });
});
