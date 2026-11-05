import { describe, expect, it } from 'vitest';
import { stripLocal, validateChange } from '../src/core/sync.ts';

const hash = 'a'.repeat(64);

describe('validateChange', () => {
  it('accepts a normal record and a tombstone', () => {
    expect(validateChange({ table: 'racks', id: 'r1', baseVersion: 0, deleted: false, data: { id: 'r1', surveyId: 's1' } })).toBeNull();
    expect(validateChange({ table: 'racks', id: 'r1', baseVersion: 3, deleted: true, data: null })).toBeNull();
  });

  it('rejects unknown tables, bad ids and mismatched data', () => {
    expect(validateChange({ table: 'users', id: 'x', baseVersion: 0, deleted: false, data: { id: 'x' } })).toMatch(/таблица/);
    expect(validateChange({ table: 'racks', id: '../x', baseVersion: 0, deleted: false, data: { id: '../x' } })).toMatch(/идентификатор/);
    expect(validateChange({ table: 'racks', id: 'r1', baseVersion: 0, deleted: false, data: { id: 'r2', surveyId: 's' } })).toMatch(/не съвпада/);
    expect(validateChange({ table: 'racks', id: 'r1', baseVersion: -1, deleted: false, data: { id: 'r1', surveyId: 's' } })).toMatch(/версия/);
  });

  it('requires the parent survey and a photo hash', () => {
    expect(validateChange({ table: 'devices', id: 'd1', baseVersion: 0, deleted: false, data: { id: 'd1' } })).toMatch(/оглед/);
    expect(validateChange({ table: 'photos', id: 'p1', baseVersion: 0, deleted: false, data: { id: 'p1', surveyId: 's' } })).toMatch(/отпечатък/);
    expect(validateChange({ table: 'photos', id: 'p1', baseVersion: 0, deleted: false, data: { id: 'p1', surveyId: 's', hash } })).toBeNull();
  });
});

describe('stripLocal', () => {
  it('removes device-only fields', () => {
    expect(stripLocal({ id: 'p', blob: {}, uploaded: true, version: 4, hash })).toEqual({ id: 'p', hash });
  });
});
