/**
 * Smoke test for the V3 Django pack pair.
 *
 * Spec: V3 Pack Migration Batch (Task Group 4)
 *
 * Migrated from direct `extractPythonIR` + `runDjangoAdapter` invocation
 * to the V3 pack shape: `pythonLangPack.extract` +
 * `djangoFrameworkPack.adapt`. All assertions are preserved verbatim — only
 * the invocation shape changes (find-and-replace pattern established in
 * Task Group 2's `springBootAdapter.smoke.test.ts`).
 */
import { pythonLangPack } from '../services/extensionPacks/languagePacks/pythonLangPack';
import { djangoFrameworkPack } from '../services/extensionPacks/frameworkPacks/djangoFrameworkPack';
import type { TechHints } from '../services/extensionPacks';

const DJANGO_HINTS: TechHints = {
  '0': { language: 'Python' },
  '1': { technology: 'Django' },
};

const MODEL_SRC = `
from django.db import models


class Author(models.Model):
    name = models.CharField(max_length=100, null=False)
    email = models.EmailField()


class Book(models.Model):
    title = models.CharField(max_length=200, null=False)
    author = models.ForeignKey(Author, on_delete=models.CASCADE)
    tags = models.ManyToManyField('Tag')
    published_at = models.DateTimeField(null=True)
    _private_helper = 42  # should be skipped (starts with _)


# Intermediate base (still detected by inheritance chain)
class TimestampedModel(models.Model):
    created_at = models.DateTimeField()


class Article(TimestampedModel):
    headline = models.CharField(max_length=300)
`;

const VIEW_SRC = `
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet


class AuthorList(APIView):
    def get(self, request):
        return None


class BookViewSet(ModelViewSet):
    pass
`;

const SERIALIZER_SRC = `
from rest_framework import serializers


class AuthorSerializer(serializers.ModelSerializer):
    name = serializers.CharField()
    email = serializers.EmailField()

    class Meta:
        model = 'Author'
        fields = ['name', 'email']
`;

const SERVICE_SRC = `
def calculate_order_total(items):
    return sum(i.price for i in items)


def evaluate_discount_policy(user, order):
    return 0


# CRUD prefix — should be skipped
def create_order(payload):
    return None


def get_user(user_id):
    return None


# Starts with underscore — skipped
def _internal_helper():
    pass
`;

/**
 * Helper: run the full V3 pipeline (extract + adapt) for a set of file
 * sources. Mirrors the earlier "build IR list, then run adapter" two-step
 * shape but goes through `pythonLangPack` + `djangoFrameworkPack`.
 */
function runV3Pipeline(files: Map<string, string>, runId: string) {
  const irFiles = pythonLangPack.extract(files, DJANGO_HINTS);
  return djangoFrameworkPack.adapt(irFiles, runId, DJANGO_HINTS);
}

describe('Django V3 pack pair smoke tests', () => {
  const files = new Map<string, string>([
    ['shop/models.py', MODEL_SRC],
    ['shop/views.py', VIEW_SRC],
    ['shop/serializers.py', SERIALIZER_SRC],
    ['shop/services.py', SERVICE_SRC],
  ]);

  it('emits physical_entity for each Django model class (including via intermediate base)', () => {
    const c = runV3Pipeline(files, 'dj-smoke');
    const names = c.filter((x) => x.candidateType === 'physical_data_entities').map((e) => e.name).sort();
    expect(names).toEqual(['Article', 'Author', 'Book', 'TimestampedModel']);
  });

  it('emits physical_attribute for each field assigned to models.*Field()', () => {
    const c = runV3Pipeline(files, 'dj-smoke');
    const attrs = c.filter((x) => x.candidateType === 'physical_data_attributes');
    // Author: name, email
    // Book: title, published_at (ForeignKey/ManyToManyField are relationships, NOT attributes)
    // TimestampedModel: created_at
    // Article: headline
    const names = attrs.map((a) => a.name).sort();
    expect(names).toEqual(['created_at', 'email', 'headline', 'name', 'published_at', 'title']);
    // Field type captured from the factory function name
    const title = attrs.find((a) => a.name === 'title')!;
    expect(title.data.fieldType).toBe('CharField');
  });

  it('emits entity_relationship for ForeignKey / ManyToManyField', () => {
    const c = runV3Pipeline(files, 'dj-smoke');
    const rels = c.filter((x) => x.candidateType === 'logical_data_entity_relationships').map((r) => r.name).sort();
    expect(rels).toEqual(['Book → Author', 'Book → Tag']);
    const fk = c.find((x) => x.name === 'Book → Author')!;
    expect(fk.data.cardinality).toBe('MANY_TO_ONE');
    const m2m = c.find((x) => x.name === 'Book → Tag')!;
    expect(m2m.data.cardinality).toBe('MANY_TO_MANY');
  });

  it('emits interface for class-based views (APIView / ModelViewSet)', () => {
    const c = runV3Pipeline(files, 'dj-smoke');
    const ifaces = c.filter((x) => x.candidateType === 'interfaces').map((i) => i.name).sort();
    expect(ifaces).toEqual(['AuthorList', 'BookViewSet']);
  });

  it('emits logical_entity + logical_data_attribute for DRF serializer', () => {
    const c = runV3Pipeline(files, 'dj-smoke');
    const logs = c.filter((x) => x.candidateType === 'logical_data_entities').map((l) => l.name);
    expect(logs).toContain('AuthorSerializer');
    const attrs = c.filter((x) => x.candidateType === 'logical_data_attributes' && (x.data as any).logicalEntityName === 'AuthorSerializer');
    const names = attrs.map((a) => a.name).sort();
    expect(names).toEqual(['email', 'name']);
  });

  it('emits business_logic only for non-CRUD functions in services.py', () => {
    const c = runV3Pipeline(files, 'dj-smoke');
    const bl = c.filter((x) => x.candidateType === 'business_logics').map((b) => b.name).sort();
    expect(bl).toEqual(['calculate_order_total', 'evaluate_discount_policy']);
  });
});
