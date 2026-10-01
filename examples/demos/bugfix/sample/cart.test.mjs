import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartTotal } from './cart.mjs';

test('empty cart', () => assert.equal(cartTotal([]), 0));
test('single product', () => assert.equal(cartTotal([{ price: 9, quantity: 2 }]), 18));
test('multiple products', () => assert.equal(cartTotal([{ price: 9, quantity: 2 }, { price: 8, quantity: 3 }]), 42));
