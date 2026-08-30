import { describe, expect, it } from 'vitest';
import { parseFillResponse } from './parse-fill-response.js';
import { parseRawAmount } from './clob-amounts.js';

describe('parseRawAmount', () => {
  it('converts 6-decimal raw strings to human units', () => {
    expect(parseRawAmount('100000000')).toBe(100);
    expect(parseRawAmount('50000000')).toBe(50);
    expect(parseRawAmount('650000')).toBe(0.65);
  });

  it('returns 0 for invalid values', () => {
    expect(parseRawAmount('')).toBe(0);
    expect(parseRawAmount('abc')).toBe(0);
    expect(parseRawAmount('-1')).toBe(0);
  });
});

describe('parseFillResponse', () => {
  const orderId = '0xabcdef1234567890abcdef1234567890abcdef12';

  it('parses BUY matched order (doc example: 100 pUSD → 200 shares @ 0.5)', () => {
    const result = parseFillResponse(
      {
        success: true,
        orderID: orderId,
        status: 'matched',
        makingAmount: '100000000',
        takingAmount: '200000000',
        errorMsg: '',
      },
      'BUY',
      0.5,
      200,
    );
    expect(result).toEqual({
      type: 'matched',
      fill: {
        orderId,
        fillQuantity: 200,
        actualFillPrice: 0.5,
      },
    });
  });

  it('parses SELL matched order', () => {
    const result = parseFillResponse(
      {
        orderID: orderId,
        status: 'matched',
        makingAmount: '50000000',
        takingAmount: '25000000',
      },
      'SELL',
      0.5,
      50,
    );
    expect(result).toEqual({
      type: 'matched',
      fill: {
        orderId,
        fillQuantity: 50,
        actualFillPrice: 0.5,
      },
    });
  });

  it('returns not_matched for unmatched with zero fill', () => {
    const result = parseFillResponse(
      {
        orderID: orderId,
        status: 'unmatched',
        makingAmount: '100000000',
        takingAmount: '0',
      },
      'BUY',
      0.5,
      100,
    );
    expect(result).toEqual({ type: 'not_matched', status: 'unmatched' });
  });

  it('returns not_matched for delayed with zero fill', () => {
    const result = parseFillResponse(
      {
        orderID: orderId,
        status: 'delayed',
        makingAmount: '0',
        takingAmount: '0',
      },
      'BUY',
      0.5,
      100,
    );
    expect(result).toEqual({ type: 'delayed', status: 'delayed' });
  });

  it('returns rejected for FAILED and REJECTED status', () => {
    expect(
      parseFillResponse(
        { orderID: orderId, status: 'FAILED', makingAmount: '0', takingAmount: '0' },
        'BUY',
        0.5,
        100,
      ),
    ).toEqual({ type: 'rejected', status: 'FAILED', reason: 'FAILED' });

    expect(
      parseFillResponse(
        { orderID: orderId, status: 'REJECTED', makingAmount: '0', takingAmount: '0' },
        'SELL',
        0.5,
        100,
      ),
    ).toEqual({ type: 'rejected', status: 'REJECTED', reason: 'REJECTED' });
  });

  it('prefers errorMsg as rejected reason on FAILED/REJECTED status', () => {
    expect(
      parseFillResponse(
        {
          orderID: orderId,
          status: 'REJECTED',
          makingAmount: '0',
          takingAmount: '0',
          errorMsg: 'INSUFFICIENT_ALLOWANCE',
        },
        'BUY',
        0.5,
        100,
      ),
    ).toEqual({ type: 'rejected', status: 'REJECTED', reason: 'INSUFFICIENT_ALLOWANCE' });
  });

  it('returns rejected when success=false with zero fill', () => {
    const result = parseFillResponse(
      {
        orderID: orderId,
        status: 'unmatched',
        success: false,
        makingAmount: '0',
        takingAmount: '0',
        errorMsg: 'INSUFFICIENT_BALANCE',
      },
      'BUY',
      0.5,
      100,
    );
    expect(result.type).toBe('rejected');
    if (result.type === 'rejected') {
      expect(result.reason).toBe('INSUFFICIENT_BALANCE');
    }
  });

  it('returns rejected when HTTP error field is present with zero fill', () => {
    const result = parseFillResponse(
      {
        orderID: orderId,
        status: 'unmatched',
        makingAmount: '0',
        takingAmount: '0',
        error: 'MINIMUM_ORDER_SIZE',
      },
      'BUY',
      0.5,
      100,
    );
    expect(result.type).toBe('rejected');
    if (result.type === 'rejected') {
      expect(result.reason).toContain('MINIMUM_ORDER_SIZE');
    }
  });

  it('returns rejected when error is a JSON object (non-2xx body)', () => {
    const result = parseFillResponse(
      {
        orderID: orderId,
        status: 'unmatched',
        makingAmount: '0',
        takingAmount: '0',
        error: { message: 'signature invalid' },
      },
      'BUY',
      0.5,
      100,
    );
    expect(result.type).toBe('rejected');
    if (result.type === 'rejected') {
      expect(result.reason).toContain('signature invalid');
    }
  });

  it('returns not_matched for a FAK kill even when success=false', () => {
    const result = parseFillResponse(
      {
        orderID: orderId,
        status: 'unmatched',
        success: false,
        makingAmount: '0',
        takingAmount: '0',
        errorMsg: 'No orders found to match with FAK',
      },
      'BUY',
      0.5,
      100,
    );
    expect(result).toEqual({ type: 'not_matched', status: 'unmatched' });
  });

  it('returns not_matched for a genuine FAK kill (no counterparty)', () => {
    const result = parseFillResponse(
      {
        orderID: orderId,
        status: 'unmatched',
        makingAmount: '0',
        takingAmount: '0',
        errorMsg: 'No orders found to match with FAK',
      },
      'BUY',
      0.5,
      100,
    );
    expect(result).toEqual({ type: 'not_matched', status: 'unmatched' });
  });

  it('returns invalid when price is implausible (inverted mapping would give 2.0)', () => {
    const result = parseFillResponse(
      {
        orderID: orderId,
        status: 'matched',
        makingAmount: '100000000',
        takingAmount: '200000000',
      },
      'SELL',
      0.5,
      200,
    );
    expect(result.type).toBe('invalid');
    if (result.type === 'invalid') {
      expect(result.reason).toBe('fill_parse_invalid_price');
    }
  });

  it('returns invalid when fill quantity exceeds requested by more than 1%', () => {
    const result = parseFillResponse(
      {
        orderID: orderId,
        status: 'matched',
        makingAmount: '100000000',
        takingAmount: '200000000',
      },
      'BUY',
      0.5,
      100,
    );
    expect(result).toEqual({
      type: 'invalid',
      status: 'matched',
      reason: 'fill_parse_invalid_quantity',
    });
  });

  it('accepts partial fill within 1% tolerance of requested quantity', () => {
    const result = parseFillResponse(
      {
        orderID: orderId,
        status: 'matched',
        makingAmount: '49500000',
        takingAmount: '99000000',
      },
      'BUY',
      0.5,
      100,
    );
    expect(result.type).toBe('matched');
    if (result.type === 'matched') {
      expect(result.fill.fillQuantity).toBe(99);
      expect(result.fill.actualFillPrice).toBeCloseTo(0.5);
    }
  });

  it('parses human-decimal amounts from CLOB V2 market order responses', () => {
    const result = parseFillResponse(
      {
        orderID: orderId,
        status: 'matched',
        makingAmount: '1',
        takingAmount: '2.5',
      },
      'BUY',
      0.4,
      2.38,
    );
    expect(result).toEqual({
      type: 'matched',
      fill: {
        orderId,
        fillQuantity: 2.5,
        actualFillPrice: 0.4,
      },
    });
  });

  it('accepts numeric status from CLOB response', () => {
    const result = parseFillResponse(
      {
        orderID: orderId,
        status: 1,
        makingAmount: '100000000',
        takingAmount: '200000000',
      },
      'BUY',
      0.5,
      200,
    );
    expect(result).toEqual({
      type: 'matched',
      fill: {
        orderId,
        fillQuantity: 200,
        actualFillPrice: 0.5,
      },
    });
  });
});
