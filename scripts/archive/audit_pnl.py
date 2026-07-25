#!/usr/bin/env python3
"""
Audit script pour investiguer l'ecart PnL session vs (historique + positions ouvertes)
Usage: python scripts/audit_pnl.py
"""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "data" / "polywatch.db"

def fmt(v):
    return f"{v:+.4f}" if v is not None else "NULL"

def main():
    if not DB_PATH.exists():
        print(f"DB non trouvee: {DB_PATH}")
        return

    print("=" * 80)
    print(f"AUDIT PnL SIMULATION")
    print(f"DB: {DB_PATH}")
    print(f"Size: {DB_PATH.stat().st_size:,} bytes")
    print("=" * 80)

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # --- 1. BALANCE SIM ---
    print("\n### 1. SIMULATION BALANCE")
    cur.execute("SELECT * FROM simulation_balances LIMIT 1")
    bal = cur.fetchone()
    if bal:
        sim_cash = bal["amount"]
        print(f"  Cash (amount): {sim_cash:.4f} {bal['token']}")
    else:
        print("  Aucune balance sim trouvee!")
        sim_cash = 0.0

    # --- 2. RISK CONFIG (capital initial) ---
    print("\n### 2. RISK CONFIG (Capital initial)")
    cur.execute("SELECT sim_initial_capital FROM risk_config LIMIT 1")
    risk = cur.fetchone()
    if risk:
        sim_initial = risk["sim_initial_capital"] or 0.0
        print(f"  sim_initial_capital: {sim_initial:.4f}")
    else:
        sim_initial = 0.0
        print("  Pas de risk_config")

    # --- 3. POSITIONS SIM ---
    print("\n### 3. POSITIONS SIM (tous statuts)")
    cur.execute("""
        SELECT id, status, outcome, quantity, entry_price, entry_bid_vwap,
               executable_bid_vwap, unrealized_pnl, realized_pnl, condition_id
        FROM copied_positions
        WHERE mode = 'sim'
        ORDER BY id DESC
    """)
    positions = cur.fetchall()
    print(f"  Total positions sim: {len(positions)}")

    total_positions_value_backend = 0.0
    open_pnl_sum = 0.0
    closed_pnl_sum = 0.0
    open_count = 0
    closing_count = 0
    pending_count = 0
    closed_count = 0

    for pos in positions:
        status = pos["status"]
        qty = pos["quantity"] or 0.0
        entry_price = pos["entry_price"] or 0.0
        bid_vwap = pos["executable_bid_vwap"] or pos["entry_bid_vwap"] or entry_price
        unrealized = pos["unrealized_pnl"] or 0.0
        realized = pos["realized_pnl"] or 0.0

        mark = bid_vwap if bid_vwap > 0 else (pos["entry_bid_vwap"] or entry_price)
        pos_value = qty * mark

        print(f"  #{pos['id']} [{status}] qty={qty} entry={entry_price:.4f} "
              f"mark={mark:.4f} value={pos_value:.4f} "
              f"unrealized={fmt(unrealized)} realized={fmt(realized)}")

        if status in ("open", "closing", "pending_resolution"):
            total_positions_value_backend += pos_value
            open_pnl_sum += unrealized
            if status == "open": open_count += 1
            elif status == "closing": closing_count += 1
            elif status == "pending_resolution": pending_count += 1
        else:
            closed_pnl_sum += realized
            closed_count += 1

    print(f"\n  Breakdown:")
    print(f"    Open: {open_count}, Closing: {closing_count}, Pending: {pending_count}, Closed/Other: {closed_count}")
    print(f"    Positions value (backend mark): {total_positions_value_backend:.4f}")
    print(f"    Sum unrealized PnL (open/closing/pending): {open_pnl_sum:.4f}")
    print(f"    Sum realized PnL (closed): {closed_pnl_sum:.4f}")

    # --- 4. EXECUTIONS SIM ---
    print("\n### 4. EXECUTIONS SIM")
    cur.execute("""
        SELECT id, copied_position_id, side, fill_price, fill_quantity, status, realized_pnl
        FROM executions
        WHERE mode = 'sim'
        ORDER BY id DESC
    """)
    executions = cur.fetchall()
    print(f"  Total executions sim: {len(executions)}")

    total_buy_cost = 0.0
    total_sell_credit = 0.0
    total_exec_pnl = 0.0
    buy_count = 0
    sell_count = 0

    for ex in executions:
        side = ex["side"]
        fill_price = ex["fill_price"] or 0.0
        fill_qty = ex["fill_quantity"] or 0.0
        pnl_realized = ex["realized_pnl"] or 0.0
        cost = fill_price * fill_qty

        print(f"  #{ex['id']} pos=#{ex['copied_position_id']} [{side}] "
              f"fill={fill_price:.4f} qty={fill_qty} cost={cost:.4f} "
              f"realized_pnl={fmt(pnl_realized)}")

        if side == "BUY":
            total_buy_cost += cost
            buy_count += 1
        elif side == "SELL":
            total_sell_credit += cost
            sell_count += 1
        total_exec_pnl += pnl_realized

    print(f"\n  Sum BUY cost: {total_buy_cost:.4f} ({buy_count} trades)")
    print(f"  Sum SELL credit: {total_sell_credit:.4f} ({sell_count} trades)")
    print(f"  Net cash flow (sell - buy): {total_sell_credit - total_buy_cost:.4f}")
    print(f"  Sum execution realized_pnl: {total_exec_pnl:.4f}")

    # --- 5. RECONCILIATION ---
    print("\n" + "=" * 80)
    print("### 5. RECONCILIATION PnL SESSION")
    print("=" * 80)

    equity_backend = sim_cash + total_positions_value_backend
    pnl_session_backend = equity_backend - sim_initial

    print(f"\n  Capital initial:     {sim_initial:>12.4f}")
    print(f"  Cash (DB):           {sim_cash:>12.4f}")
    print(f"  Positions value:     {total_positions_value_backend:>12.4f}")
    print(f"  Equity (cash + pos): {equity_backend:>12.4f}")
    print(f"  PnL Session (DB):    {pnl_session_backend:>12.4f}")

    print(f"\n  --- Verifications ---")
    print(f"  Historique (sum realized PnL positions): {closed_pnl_sum:>12.4f}")
    print(f"  Positions ouvertes (sum unrealized):       {open_pnl_sum:>12.4f}")
    print(f"  Somme histo + ouvert:                      {closed_pnl_sum + open_pnl_sum:>12.4f}")
    print(f"  Ecart vs PnL Session:                    {pnl_session_backend - (closed_pnl_sum + open_pnl_sum):>12.4f}")

    cash_residual = sim_cash - (sim_initial - total_buy_cost + total_sell_credit)
    print(f"\n  Cash residual (cash - (initial - buy + sell)): {cash_residual:.4f}")
    print(f"  Si residual = 0, le cash est coherent avec les executions.")
    print(f"  Si residual != 0, il y a un ajustement cash non explique.")

    # --- 6. CHECK ORPHAN ISSUES ---
    print("\n### 6. VERIFICATIONS ORPHELINS")

    cur.execute("""
        SELECT cp.id, cp.status, cp.outcome, cp.entry_price, cp.quantity
        FROM copied_positions cp
        WHERE cp.mode = 'sim'
          AND cp.id NOT IN (
              SELECT DISTINCT copied_position_id FROM executions
              WHERE mode = 'sim' AND copied_position_id IS NOT NULL
          )
    """)
    orphan_pos = cur.fetchall()
    if orphan_pos:
        print(f"  ALERT: {len(orphan_pos)} positions sim sans execution!")
        for op in orphan_pos:
            print(f"    #{op['id']} status={op['status']} {op['outcome']} qty={op['quantity']} entry={op['entry_price']}")
    else:
        print(f"  OK: Toutes les positions sim ont au moins une execution.")

    cur.execute("""
        SELECT e.id, e.copied_position_id, e.side, e.fill_price, e.fill_quantity
        FROM executions e
        WHERE e.mode = 'sim'
          AND e.copied_position_id IS NOT NULL
          AND e.copied_position_id NOT IN (SELECT id FROM copied_positions)
    """)
    orphan_exec = cur.fetchall()
    if orphan_exec:
        print(f"  ALERT: {len(orphan_exec)} executions sim sans position!")
        for oe in orphan_exec:
            print(f"    #{oe['id']} pos_id={oe['copied_position_id']} {oe['side']} fill={oe['fill_price']} qty={oe['fill_quantity']}")
    else:
        print(f"  OK: Toutes les executions sim referencent une position existante.")

    cur.execute("SELECT COUNT(*) as cnt FROM simulation_balances")
    bal_count = cur.fetchone()["cnt"]
    if bal_count > 1:
        print(f"  ALERT: {bal_count} lignes dans simulation_balances (attendu: 1)")
    else:
        print(f"  OK: 1 ligne dans simulation_balances.")

    # --- 7. POSITION RESERVATIONS ---
    print("\n### 7. POSITION RESERVATIONS SIM")
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='position_reservations'")
    if cur.fetchone():
        cur.execute("SELECT COUNT(*) as cnt FROM position_reservations WHERE mode = 'sim'")
        res_count = cur.fetchone()["cnt"]
        print(f"  Reservations sim: {res_count}")
    else:
        print("  Table position_reservations non trouvee.")

    conn.close()
    print(f"\n{'=' * 80}")
    print("Audit termine.")

if __name__ == "__main__":
    main()
