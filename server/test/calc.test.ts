import { describe, it, expect } from 'vitest';
import { netTenths, amountPaisa, fmtINR, fmtKg, parseTenths } from '@app/shared';

// The three sample rows from the brief must reproduce exactly.
describe('brief sample data', () => {
  it('Sunil Jadhav soybean: 1250.0 - 18.0 @ 11.5% -> 1232.0 kg, Rs 59,752.00', () => {
    const net = netTenths(12500, 180, 115);
    expect(net).toBe(12320);
    expect(amountPaisa(net, 4850)).toBe(5975200);
  });
  it('Kamal Shinde soybean: 860.0 - 12.0 @ 14.0% -> 831.0 kg, Rs 40,303.50', () => {
    const net = netTenths(8600, 120, 140);
    expect(net).toBe(8310);
    expect(amountPaisa(net, 4850)).toBe(4030350);
  });
  it('Mohan Biradar tur: 640.0 - 10.0 @ 10.0% -> 630.0 kg, Rs 45,360.00', () => {
    const net = netTenths(6400, 100, 100);
    expect(net).toBe(6300);
    expect(amountPaisa(net, 7200)).toBe(4536000);
  });
});

describe('calc edges', () => {
  it('fractional moisture point above 12 deducts proportionally', () => {
    // 1000 kg raw at 13.0% -> 1 point over -> 990.0
    expect(netTenths(10000, 0, 130)).toBe(9900);
  });
  it('moisture below 12 never deducts', () => {
    expect(netTenths(10000, 0, 80)).toBe(10000);
  });
  it('tare heavier than gross gives zero', () => {
    expect(netTenths(100, 200, 100)).toBe(0);
  });
  it('fmtKg keeps one decimal', () => {
    expect(fmtKg(12320)).toBe('1232.0');
  });
  it('fmtINR uses Indian grouping with paisa', () => {
    expect(fmtINR(5975200)).toBe('59,752.00');
    expect(fmtINR(4030350)).toBe('40,303.50');
    expect(fmtINR(123456789)).toBe('12,34,567.89');
    expect(fmtINR(500)).toBe('5.00');
  });
  it('parseTenths accepts one decimal only', () => {
    expect(parseTenths('1250.0')).toBe(12500);
    expect(parseTenths('18')).toBe(180);
    expect(parseTenths('1.25')).toBeNull();
    expect(parseTenths('abc')).toBeNull();
    expect(parseTenths('-5')).toBeNull();
  });
});
