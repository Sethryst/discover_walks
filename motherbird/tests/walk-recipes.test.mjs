import test from 'node:test';
import assert from 'node:assert/strict';
import { WALK_RECIPES, recipeById, recipeCandidateAllowed, recipeRequest } from '../js/walk-recipes.js';
test('recipes are fixed and step-free is a hard candidate constraint', () => { assert.deepEqual(Object.keys(WALK_RECIPES), ['shadedNature', 'waterHistory', 'stepFreeNeighborhood']); const recipe = recipeById('step-free-neighborhood'); assert.equal(recipeCandidateAllowed({ wheelchair: 'no' }, recipe), false); assert.equal(recipeCandidateAllowed({ wheelchair: 'yes' }, recipe), true); assert.equal(recipeRequest(recipe).hardConstraints.stepFree, true); });
