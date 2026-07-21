/**
 * Reflection Recipes service tests (R2 Task 16).
 *
 * `recipes/{id}` docs: {name, questions, scope, timeRangeDays,
 * cadence:'manual', state:'active'|'archived', definitionVersion,
 * createdAt, updatedAt}. Owner CRUD, shape-validated by firestore.rules
 * (mirrored client-side in recipeService.js's normalizeRecipeInput).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = {
  collection: vi.fn((_db, path) => ({ __col: path })),
  doc: vi.fn((_db, path, id) => ({ __doc: `${path}/${id}` })),
  query: vi.fn((...args) => ({ __query: args })),
  where: vi.fn((f, op, v) => ({ __where: [f, op, v] })),
  orderBy: vi.fn((f, dir) => ({ __orderBy: [f, dir] })),
  onSnapshot: vi.fn(() => () => {}),
  addDoc: vi.fn(async () => ({ id: 'recipe-1' })),
  updateDoc: vi.fn(async () => {}),
};

vi.mock('../../../config/firebase', () => mocks);
vi.mock('../../../config/constants', () => ({ APP_COLLECTION_ID: 'echo-vault-v5-fresh' }));

const {
  subscribeRecipes,
  createRecipe,
  updateRecipe,
  archiveRecipe,
} = await import('../recipeService.js');

const db = {};
const UID = 'user-1';
const RECIPES_PATH = 'artifacts/echo-vault-v5-fresh/users/user-1/recipes';

function validInput(overrides = {}) {
  return {
    name: 'Monthly review',
    questions: ['What changed for me this month?'],
    timeRangeDays: 30,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.onSnapshot.mockReturnValue(() => {});
  mocks.addDoc.mockResolvedValue({ id: 'recipe-1' });
});

describe('subscribeRecipes', () => {
  it('builds a state=active, orderBy name asc query against the recipes collection', () => {
    subscribeRecipes(db, UID, () => {});
    expect(mocks.collection).toHaveBeenCalledWith(db, RECIPES_PATH);
    expect(mocks.where).toHaveBeenCalledWith('state', '==', 'active');
    expect(mocks.orderBy).toHaveBeenCalledWith('name', 'asc');
  });

  it('calls onError when the snapshot listener errors', () => {
    const onError = vi.fn();
    let errorCb;
    mocks.onSnapshot.mockImplementation((_q, _cb, errCb) => {
      errorCb = errCb;
      return () => {};
    });
    subscribeRecipes(db, UID, () => {}, onError);
    const err = new Error('boom');
    errorCb(err);
    expect(onError).toHaveBeenCalledWith(err);
  });
});

describe('createRecipe', () => {
  it('writes {name, questions, scope:null, timeRangeDays, cadence:manual, state:active, definitionVersion:1, createdAt, updatedAt} — exact key list', async () => {
    const result = await createRecipe(db, UID, validInput());
    expect(mocks.collection).toHaveBeenCalledWith(db, RECIPES_PATH);
    expect(mocks.addDoc).toHaveBeenCalledTimes(1);
    const payload = mocks.addDoc.mock.calls[0][1];
    expect(Object.keys(payload).sort()).toEqual(
      ['cadence', 'createdAt', 'definitionVersion', 'name', 'questions', 'scope', 'state', 'timeRangeDays', 'updatedAt'].sort(),
    );
    expect(payload.cadence).toBe('manual');
    expect(payload.state).toBe('active');
    expect(payload.definitionVersion).toBe(1);
    expect(payload.scope).toBeNull();
    expect(result).toEqual({ id: 'recipe-1', ...payload });
  });

  it('preserves an explicit scope object', async () => {
    await createRecipe(db, UID, validInput({ scope: { spaceId: 'work' } }));
    const payload = mocks.addDoc.mock.calls[0][1];
    expect(payload.scope).toEqual({ spaceId: 'work' });
  });

  it('rejects a name over 60 characters', async () => {
    await expect(createRecipe(db, UID, validInput({ name: 'x'.repeat(61) }))).rejects.toThrow(/60/);
    expect(mocks.addDoc).not.toHaveBeenCalled();
  });

  it('rejects more than 5 questions', async () => {
    await expect(
      createRecipe(db, UID, validInput({ questions: ['a', 'b', 'c', 'd', 'e', 'f'] })),
    ).rejects.toThrow(/5/);
    expect(mocks.addDoc).not.toHaveBeenCalled();
  });

  it('rejects zero questions', async () => {
    await expect(createRecipe(db, UID, validInput({ questions: [] }))).rejects.toThrow();
    expect(mocks.addDoc).not.toHaveBeenCalled();
  });

  it('rejects an invalid timeRangeDays', async () => {
    await expect(createRecipe(db, UID, validInput({ timeRangeDays: 14 }))).rejects.toThrow(/timeRangeDays/);
    expect(mocks.addDoc).not.toHaveBeenCalled();
  });
});

describe('updateRecipe', () => {
  it('bumps definitionVersion by 1 and writes updatedAt', async () => {
    const current = { id: 'recipe-1', ...validInput(), scope: null, cadence: 'manual', state: 'active', definitionVersion: 1 };
    const updated = await updateRecipe(db, UID, current, { name: 'Monthly review (renamed)' });

    expect(mocks.updateDoc).toHaveBeenCalledTimes(1);
    const [ref, payload] = mocks.updateDoc.mock.calls[0];
    expect(ref).toEqual({ __doc: `${RECIPES_PATH}/recipe-1` });
    expect(payload.definitionVersion).toBe(2);
    expect(payload.name).toBe('Monthly review (renamed)');
    expect(updated.definitionVersion).toBe(2);
  });

  it('bumps definitionVersion even for a no-op edit (cosmetic-only changes still bump)', async () => {
    const current = { id: 'recipe-1', ...validInput(), scope: null, cadence: 'manual', state: 'active', definitionVersion: 3 };
    await updateRecipe(db, UID, current, {});
    const payload = mocks.updateDoc.mock.calls[0][1];
    expect(payload.definitionVersion).toBe(4);
  });

  it('never touches the reflections collection (recipe edits must not mutate prior reflections)', async () => {
    const current = { id: 'recipe-1', ...validInput(), scope: null, cadence: 'manual', state: 'active', definitionVersion: 1 };
    await updateRecipe(db, UID, current, { name: 'New name' });
    const touchedReflections = mocks.collection.mock.calls.some((call) => String(call[1]).includes('reflections'))
      || mocks.doc.mock.calls.some((call) => String(call[1]).includes('reflections'));
    expect(touchedReflections).toBe(false);
  });

  it('throws without writing when the new definition is invalid', async () => {
    const current = { id: 'recipe-1', ...validInput(), scope: null, cadence: 'manual', state: 'active', definitionVersion: 1 };
    await expect(updateRecipe(db, UID, current, { questions: [] })).rejects.toThrow();
    expect(mocks.updateDoc).not.toHaveBeenCalled();
  });
});

describe('archiveRecipe', () => {
  it('sets state=archived and updatedAt only', async () => {
    await archiveRecipe(db, UID, 'recipe-1');
    expect(mocks.updateDoc).toHaveBeenCalledTimes(1);
    const [ref, payload] = mocks.updateDoc.mock.calls[0];
    expect(ref).toEqual({ __doc: `${RECIPES_PATH}/recipe-1` });
    expect(Object.keys(payload).sort()).toEqual(['state', 'updatedAt']);
    expect(payload.state).toBe('archived');
  });

  it('never touches the reflections collection (archive keeps reflections)', async () => {
    await archiveRecipe(db, UID, 'recipe-1');
    const touchedReflections = mocks.collection.mock.calls.some((call) => String(call[1]).includes('reflections'))
      || mocks.doc.mock.calls.some((call) => String(call[1]).includes('reflections'));
    expect(touchedReflections).toBe(false);
  });
});
