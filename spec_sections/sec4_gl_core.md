## 4. LAYER 3: EVENT-SOURCED DOUBLE-ENTRY GENERAL LEDGER (GL) CORE

### 4.1 Data Model & Chart of Accounts (COA) Taxonomy
The Chart of Accounts (COA) defines the complete taxonomy of an entity's financial universe:

| Class Range | Class Type | Normal Balance | Economic Function | Balance Computation Formula |
|---|---|---|---|---|
| `1000-1999` | **Asset** | **DEBIT** | Economic resources owned/controlled with future benefits | $\text{Balance} = \sum \text{Debits} - \sum \text{Credits}$ |
| `2000-2999` | **Liability** | **CREDIT** | Present legal/constructive obligations from past events | $\text{Balance} = \sum \text{Credits} - \sum \text{Debits}$ |
| `3000-3999` | **Equity** | **CREDIT** | Residual interest in assets after deducting all liabilities | $\text{Balance} = \sum \text{Credits} - \sum \text{Debits}$ |
| `4000-4999` | **Revenue** | **CREDIT** | Gross inflows of economic benefits during ordinary operations | $\text{Balance} = \sum \text{Credits} - \sum \text{Debits}$ |
| `5000-5999` | **Expense** | **DEBIT** | Outflows, asset depletions, or incurrences of liabilities | $\text{Balance} = \sum \text{Debits} - \sum \text{Credits}$ |

#### The Fundamental Mathematical Balance Proof
The classical balance sheet identity states:
$$\text{Assets} \equiv \text{Liabilities} + \text{Equity}$$
Expanding Equity to incorporate ongoing operational performance (Retained Earnings):
$$\text{Assets} \equiv \text{Liabilities} + \text{Equity}_{\text{initial}} + (\text{Revenue} - \text{Expenses})$$
Rearranging all terms so that normal debit accounts appear on the left and normal credit accounts appear on the right:
$$\text{Assets} + \text{Expenses} \equiv \text{Liabilities} + \text{Equity}_{\text{initial}} + \text{Revenue}$$
$$\iff \sum \text{Debits} - \sum \text{Credits} = 0$$

#### Numerical Representation & Precision Policy
- Binary floating-point types (`FLOAT`, `DOUBLE PRECISION`, IEEE-754) are strictly banned from the general ledger database.
- Database columns are declared as `NUMERIC(28, 4)`, providing 24 whole integer digits and 4 decimal places of fractional sub-cent precision.
- In Python runtimes, all amounts use `decimal.Decimal` with explicit `ROUND_HALF_EVEN` (Banker's Rounding) to prevent systematic accumulation bias over millions of micro-postings.

---

### 4.2 Event Sourcing vs. Mutable CRUD

#### The Failure Modes of Mutable CRUD (QuickBooks / Xero)
In traditional accounting packages, an administrator or automated webhook can open a past invoice from three months ago and mutate the line item from $1,000 to $800.
1. The historical balance sheet of three months ago mutates silently.
2. Reconciled bank accounts develop mysterious reconciliation variances.
3. Prior audited tax filings and management accounts become mathematically inconsistent.
4. An external auditor cannot verify *who* changed the record, *what* the previous state was, or *why* the mutation occurred.

#### Event-Sourced Immutable Ledger (`Storno` Accounting)
In ALE, financial records are strictly modeled as an append-only stream of immutable events:
- `JournalEntryDrafted`: A proposed entry staged in the Draft Queue.
- `JournalEntryPosted`: The atomic commitment of balanced debits and credits into the ledger.
- `JournalEntryReversed`: Original records are **never mutated or deleted**. A compensating reversal entry is posted, explicitly linking to `reverses_journal_entry_id` with inverse debit/credit directions (`storno` accounting).

#### Bi-Temporal Truth
Every journal entry records two distinct temporal dimensions:
- `effective_date` (Economic Event Date): The date when the real-world value exchange took place.
- `recorded_at` (System Ingestion Timestamp): UTC wall-clock time when the record was immutably committed into the database.

This architecture enables exact **Point-in-Time Historical Auditing**:
- *"What was our cash position on March 31, 2026, as known to the system on April 2, 2026?"*
- *"What is our cash position on March 31, 2026, as known today (incorporating late receipts and delayed reconciliations)?"*

---

### 4.3 Production-Grade PostgreSQL DDL Schema

```sql
-- ============================================================================
-- PRODUCTION-GRADE POSTGRESQL DOUBLE-ENTRY GENERAL LEDGER SCHEMA
-- Enforces: Immutability, Append-Only Event Stream, Deferred Balance Invariant
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enumerated Types
CREATE TYPE account_type_enum AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');
CREATE TYPE normal_balance_enum AS ENUM ('DEBIT', 'CREDIT');
CREATE TYPE posting_direction_enum AS ENUM ('DEBIT', 'CREDIT');
CREATE TYPE journal_entry_status_enum AS ENUM ('DRAFT', 'POSTED', 'REVERSED');

-- 1. CHART OF ACCOUNTS (COA)
CREATE TABLE chart_of_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    type account_type_enum NOT NULL,
    normal_balance normal_balance_enum NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX idx_coa_code ON chart_of_accounts(code);
CREATE INDEX idx_coa_type ON chart_of_accounts(type);

-- 2. JOURNAL ENTRIES (Header Envelope)
CREATE TABLE journal_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entry_number BIGSERIAL NOT NULL UNIQUE,
    status journal_entry_status_enum NOT NULL DEFAULT 'DRAFT',
    effective_date DATE NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    memo TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    reverses_journal_entry_id UUID REFERENCES journal_entries(id),
    created_by VARCHAR(128) NOT NULL,
    idempotency_key VARCHAR(128) UNIQUE
);

CREATE INDEX idx_je_effective_date ON journal_entries(effective_date);
CREATE INDEX idx_je_status ON journal_entries(status);
CREATE INDEX idx_je_reverses ON journal_entries(reverses_journal_entry_id);

-- 3. LEDGER POSTINGS (Legs / Splits)
CREATE TABLE ledger_postings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE RESTRICT,
    account_id UUID NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
    direction posting_direction_enum NOT NULL,
    amount NUMERIC(28, 4) NOT NULL CHECK (amount > 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    sequence_order INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX idx_postings_je ON ledger_postings(journal_entry_id);
CREATE INDEX idx_postings_acc ON ledger_postings(account_id);

-- 4. DATABASE-LEVEL BALANCE INVARIANT (Deferred Constraint Trigger)
CREATE OR REPLACE FUNCTION fn_assert_journal_entry_balanced()
RETURNS TRIGGER AS $$
DECLARE
    v_status journal_entry_status_enum;
    v_total_debit NUMERIC(28, 4);
    v_total_credit NUMERIC(28, 4);
    v_posting_count INT;
BEGIN
    SELECT status INTO v_status 
    FROM journal_entries 
    WHERE id = NEW.journal_entry_id;

    -- Only enforce double-entry balance when entry is POSTED
    IF v_status = 'POSTED' THEN
        SELECT 
            COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE 0 END), 0),
            COUNT(*)
        INTO v_total_debit, v_total_credit, v_posting_count
        FROM ledger_postings
        WHERE journal_entry_id = NEW.journal_entry_id;

        IF v_posting_count < 2 THEN
            RAISE EXCEPTION 'Financial invariant violated: Journal entry % must have at least 2 postings. Found: %', 
                NEW.journal_entry_id, v_posting_count;
        END IF;

        IF v_total_debit <> v_total_credit THEN
            RAISE EXCEPTION 'Double-entry balance violation on journal entry %: Debits (%) <> Credits (%). Net diff: %', 
                NEW.journal_entry_id, v_total_debit, v_total_credit, (v_total_debit - v_total_credit);
        END IF;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_assert_journal_entry_balanced
AFTER INSERT OR UPDATE ON ledger_postings
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION fn_assert_journal_entry_balanced();

-- 5. IMMUTABILITY ENFORCEMENT TRIGGERS (Rejects UPDATE & DELETE on POSTED)
CREATE OR REPLACE FUNCTION fn_prevent_posted_modification()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = 'POSTED' THEN
        RAISE EXCEPTION 'Financial immutability violation: Cannot % a POSTED journal entry (ID: %). Use reversal.', 
            TG_OP, OLD.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_journal_entry_tampering
BEFORE UPDATE OR DELETE ON journal_entries
FOR EACH ROW
EXECUTE FUNCTION fn_prevent_posted_modification();

CREATE OR REPLACE FUNCTION fn_prevent_posting_tampering()
RETURNS TRIGGER AS $$
DECLARE
    v_parent_status journal_entry_status_enum;
BEGIN
    SELECT status INTO v_parent_status 
    FROM journal_entries 
    WHERE id = OLD.journal_entry_id;

    IF v_parent_status = 'POSTED' THEN
        RAISE EXCEPTION 'Financial immutability violation: Cannot % postings of a POSTED journal entry (JE_ID: %).', 
            TG_OP, OLD.journal_entry_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_posting_tampering
BEFORE UPDATE OR DELETE ON ledger_postings
FOR EACH ROW
EXECUTE FUNCTION fn_prevent_posting_tampering();

-- 6. CQRS MATERIALIZED ACCOUNT BALANCES PROJECTION
CREATE TABLE account_balances (
    account_id UUID PRIMARY KEY REFERENCES chart_of_accounts(id),
    total_debits NUMERIC(28, 4) NOT NULL DEFAULT 0,
    total_credits NUMERIC(28, 4) NOT NULL DEFAULT 0,
    net_balance NUMERIC(28, 4) NOT NULL DEFAULT 0,
    version BIGINT NOT NULL DEFAULT 1,
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION fn_update_account_balances_projection()
RETURNS TRIGGER AS $$
DECLARE
    r RECORD;
    v_acc_type account_type_enum;
    v_normal normal_balance_enum;
    v_net_delta NUMERIC(28, 4);
BEGIN
    IF NEW.status = 'POSTED' AND (OLD.status IS NULL OR OLD.status <> 'POSTED') THEN
        FOR r IN 
            SELECT account_id, direction, amount 
            FROM ledger_postings 
            WHERE journal_entry_id = NEW.id
        LOOP
            SELECT type, normal_balance INTO v_acc_type, v_normal 
            FROM chart_of_accounts 
            WHERE id = r.account_id;

            IF v_normal = 'DEBIT' THEN
                v_net_delta := CASE WHEN r.direction = 'DEBIT' THEN r.amount ELSE -r.amount END;
            ELSE
                v_net_delta := CASE WHEN r.direction = 'CREDIT' THEN r.amount ELSE -r.amount END;
            END IF;

            INSERT INTO account_balances (account_id, total_debits, total_credits, net_balance, version, last_updated_at)
            VALUES (
                r.account_id,
                CASE WHEN r.direction = 'DEBIT' THEN r.amount ELSE 0 END,
                CASE WHEN r.direction = 'CREDIT' THEN r.amount ELSE 0 END,
                v_net_delta,
                1,
                clock_timestamp()
            )
            ON CONFLICT (account_id) DO UPDATE SET
                total_debits = account_balances.total_debits + CASE WHEN r.direction = 'DEBIT' THEN r.amount ELSE 0 END,
                total_credits = account_balances.total_credits + CASE WHEN r.direction = 'CREDIT' THEN r.amount ELSE 0 END,
                net_balance = account_balances.net_balance + v_net_delta,
                version = account_balances.version + 1,
                last_updated_at = clock_timestamp();
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_maintain_balances_on_post
AFTER INSERT OR UPDATE ON journal_entries
FOR EACH ROW
EXECUTE FUNCTION fn_update_account_balances_projection();
```

---

### 4.4 Engine Comparison Matrix

| Feature / Dimension | PostgreSQL (Event-Sourced Relational) | TigerBeetle (Distributed Financial DB) | Beancount (In-Memory Functional Core) |
|---|---|---|---|
| **Primary Architecture** | ACID Relational Database with append-only event tables & deferred triggers | Purpose-built financial accounting database in Zig; Viewstamped Replication (VSR) | Pure Python double-entry framework; in-memory DAG over plain-text files |
| **Throughput (TPS)** | 5,000 - 25,000 transfers/sec (partitioned) | 1,000,000+ transfers/sec | In-memory batch: ~100,000 entries/sec; Single-threaded |
| **Concurrency & Hot Accounts** | Row lock contention on high-volume root accounts (e.g. Operating Cash) requires batching | Designed specifically to avoid lock contention via pipelined state-machine batches | Single-threaded; no concurrent multi-client transactional writes |
| **Balance Invariant Enforcement** | `DEFERRABLE INITIALLY DEFERRED` constraint triggers + CHECK constraints | Native state machine enforces credit/debit balance per transfer batch | Functional assertions (`balance` directive) verified during DAG compilation |
| **Audit & Immutability** | Guaranteed via Table Permissions (`REVOKE UPDATE, DELETE`) + append-only triggers | Strictly immutable; storage layout guarantees zero overwrites | Immutable by convention (git-tracked plain text files) |
| **Two-Phase Transfers** | Application-level state machine (`DRAFT` -> `POSTED`) | Built-in two-phase commits (`pending` -> `post_pending_transfer`) with timeout expirations | Not supported natively; requires manual pending tag convention |
| **Ad-Hoc Querying & Reporting** | **Superior**: Full SQL, Window functions, CTEs, JSONB metadata, relational joins | **Limited**: Fixed schema (128-bit IDs, transfer flags); requires external SQL sink | Excellent custom query language (BQL - Beancount Query Language) |
| **Operational Complexity** | Low-to-Medium: Standard RDS / Postgres ops | High: Specialized cluster operations, custom Zig driver protocols | Zero ops: Embedded library, but lacks multi-tenant server infrastructure |
| **Architectural Verdict** | **Primary OLTP/GL Core for enterprise SaaS & autonomous agents** (rich metadata + compliance) | **High-frequency payments rail & wallet core** (millions of daily micropayments) | **Local agent sandbox & algorithmic verification harness** |

---
