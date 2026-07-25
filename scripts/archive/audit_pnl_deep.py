#!/usr/bin/env python3
"""
Deep audit - investigate PnL gap causes
"""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "data" / "polywatch.db"

def main():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # --- FAILED POSITIONS ---
    print("=== POSITIONS FAILED (qty > 0) ===")
    cur.execute("""
        SELECT id, status, outcome, quantity, entry_price, entry_bid_vwap,
               executable_bid_vwap, unrealized_pnl, realized_pnl, entry_fees, entry_fees_remaining
        FROM copied_positions
        WHERE mode = 'sim' AND status = 'failed' AND quantity > 0
        ORDER BY id DESC
    """)
    failed = cur.fetchall()
    total_failed_value = 0.0
    total_failed_qty = 0.0
    for pos in failed:
        bid = pos['executable_bid_vwap'] or pos['entry_bid_vwap'] or pos['entry_price']
        val = pos['quantity'] * bid
        total_failed_value += val
        total_failed_qty += pos['quantity']
        print(f"  #{pos['id']} qty={pos['quantity']:.2f} entry={pos['entry_price']:.4f} "
              f"bid={bid:.4f} value={val:.4f} fees={(pos['entry_fees'] or 0):.4f} "
              f"fees_rem={(pos['entry_fees_remaining'] or 0):.4f}")
    print(f"  Total failed qty: {total_failed_qty:.4f}")
    print(f"  Total failed value: {total_failed_value:.4f}")

    # Check executions for failed positions
    print("\n=== EXECUTIONS FOR FAILED POSITIONS ===")
    total_failed_cash_locked = 0.0
    for pos in failed:
        cur.execute("""
            SELECT id, side, fill_price, fill_quantity, status, realized_pnl
            FROM executions
            WHERE mode = 'sim' AND copied_position_id = ?
        """, (pos['id'],))
        execs = cur.fetchall()
        total_buy = sum(e['fill_price'] * e['fill_quantity'] for e in execs if e['side'] == 'BUY')
        total_sell = sum(e['fill_price'] * e['fill_quantity'] for e in execs if e['side'] == 'SELL')
        net = total_sell - total_buy
        total_failed_cash_locked += net
        print(f"  pos #{pos['id']}: {len(execs)} execs, BUY={total_buy:.4f}, SELL={total_sell:.4f}, net={net:.4f}")
    print(f"  Total cash locked in failed positions (SELL - BUY): {total_failed_cash_locked:.4f}")

    # --- CANCELLED POSITIONS ---
    print("\n=== POSITIONS CANCELLED (qty > 0) ===")
    cur.execute("""
        SELECT id, status, outcome, quantity, entry_price, entry_bid_vwap,
               executable_bid_vwap, entry_fees, entry_fees_remaining
        FROM copied_positions
        WHERE mode = 'sim' AND status = 'cancelled' AND quantity > 0
        ORDER BY id DESC
    """)
    cancelled = cur.fetchall()
    total_cancelled_value = 0.0
    total_cancelled_cash = 0.0
    for pos in cancelled:
        bid = pos['executable_bid_vwap'] or pos['entry_bid_vwap'] or pos['entry_price']
        val = pos['quantity'] * bid
        total_cancelled_value += val

        cur.execute("""
            SELECT side, fill_price, fill_quantity FROM executions
            WHERE mode = 'sim' AND copied_position_id = ?
        """, (pos['id'],))
        execs = cur.fetchall()
        total_buy = sum(e['fill_price'] * e['fill_quantity'] for e in execs if e['side'] == 'BUY')
        total_sell = sum(e['fill_price'] * e['fill_quantity'] for e in execs if e['side'] == 'SELL')
        total_cancelled_cash += (total_sell - total_buy)
        print(f"  #{pos['id']} qty={pos['quantity']:.2f} entry={pos['entry_price']:.4f} "
              f"bid={bid:.4f} value={val:.4f} BUY={total_buy:.4f} SELL={total_sell:.4f}")
    print(f"  Total cancelled value: {total_cancelled_value:.4f}")
    print(f"  Total cancelled cash locked: {total_cancelled_cash:.4f}")

    # --- FEES ANALYSIS ---
    print("\n=== ENTRY FEES ANALYSIS ===")
    cur.execute("""
        SELECT SUM(entry_fees) as total_fees, SUM(entry_fees_remaining) as total_fees_rem
        FROM copied_positions WHERE mode = 'sim'
    """)
    fees = cur.fetchone()
    total_fees = fees['total_fees'] or 0.0
    total_fees_rem = fees['total_fees_rem'] or 0.0
    print(f"  Total entry_fees: {total_fees:.4f}")
    print(f"  Total entry_fees_remaining: {total_fees_rem:.4f}")
    print(f"  Fees consommees (total - remaining): {total_fees - total_fees_rem:.4f}")

    # --- OPEN POSITIONS with entry_fees_remaining ---
    print("\n=== OPEN POSITIONS with entry_fees_remaining > 0 ===")
    cur.execute("""
        SELECT id, quantity, entry_price, entry_fees_remaining
        FROM copied_positions
        WHERE mode = 'sim' AND status = 'open' AND entry_fees_remaining > 0
    """)
    for pos in cur.fetchall():
        print(f"  #{pos['id']} qty={pos['quantity']:.2f} entry={pos['entry_price']:.4f} "
              f"fees_rem={pos['entry_fees_remaining']:.4f}")

    # --- RECONCILIATION WITH FAILED POSITIONS ---
    print("\n" + "=" * 80)
    print("=== RECONCILIATION AVEC POSITIONS FAILED/CANCELLED ===")
    print("=" * 80)

    # Cash residual computed earlier
    sim_initial = 50.0
    total_buy = 114.3134
    total_sell = 87.1280
    sim_cash = 18.1375
    cash_residual = sim_cash - (sim_initial - total_buy + total_sell)

    print(f"\n  Cash residual (base): {cash_residual:.4f}")
    print(f"  + Cash locked in failed positions: {total_failed_cash_locked:.4f}")
    print(f"  + Cash locked in cancelled positions: {total_cancelled_cash:.4f}")
    print(f"  + Positions value (failed): {total_failed_value:.4f}")
    print(f"  + Positions value (cancelled): {total_cancelled_value:.4f}")
    print(f"  - Fees consumed: {total_fees - total_fees_rem:.4f}")

    adjusted_residual = (cash_residual + total_failed_cash_locked + total_cancelled_cash +
                         total_failed_value + total_cancelled_value - (total_fees - total_fees_rem))
    print(f"\n  Residual apres ajustement: {adjusted_residual:.4f}")
    print(f"  Si ~0, tout est explique. Sinon, il reste un ecart.")

    conn.close()

if __name__ == "__main__":
    main()
