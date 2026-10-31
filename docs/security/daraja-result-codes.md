# Safaricom Daraja Lipa Na M-Pesa Online (`stkpushquery/v1/query`) ResultCode Classification Evidence

## Purpose & Fail-Safe Design Principle (`W1-AC-05`)

All M-Pesa payment state transitions in `CommerceService` and `MpesaReconciliationWorker` rely on **server-to-server** `POST /mpesa/stkpushquery/v1/query` verification rather than unauthenticated webhook callbacks.

To guarantee that a legitimate customer debit is **never** falsely marked `FAILED` or `CANCELLED` due to transient gateway conditions, sandbox quirks, or undocumented upstream codes:

1. HTTP non-200 responses, timeouts (`8s`), and network errors classify as `QUERY_TRANSPORT_ERROR` (retryable).
2. HTTP 200 responses where `String(ResponseCode) !== "0"` classify as `QUERY_INCONCLUSIVE_RETRYABLE` without inspecting `ResultCode`.
3. When `String(ResponseCode) === "0"`, `ResultCode` is evaluated against an **evidence-backed closed allowlist**:
   - Only `"0"` maps to `TRANSACTION_CONFIRMED_COMPLETED`.
   - Only `"1032"` maps to `TRANSACTION_CONFIRMED_CANCELLED`.
   - Only codes with established, documented **terminal non-debit finality** in Safaricom Daraja Lipa Na M-Pesa Online (`stkpush/v1` / `stkpushquery/v1`) are included in `DARAJA_CONFIRMED_FAILURE_CODES` (`TRANSACTION_CONFIRMED_FAILED`).
   - **Every other code**—including subscriber-lock contention (`1001`), push dispatch errors (`1025`), in-flight processing codes (`4999`, `500.001.1001`), missing/null/malformed values, or future Safaricom codes—maps to `QUERY_INCONCLUSIVE_RETRYABLE` and escalates to `RECONCILIATION_REQUIRED` after 10 bounded attempts for human financial verification.

---

## Closed Allowlist Evidence Table

| `ResultCode` | Classification | Safaricom Daraja Lipa Na M-Pesa Online (`stkpushquery/v1`) Specification Meaning | Debit Finality & Inclusion Rationale |
| :--- | :--- | :--- | :--- |
| `"0"` | `TRANSACTION_CONFIRMED_COMPLETED` | *The service request is processed successfully.* | Authoritative M-Pesa core ledger completion (`ResponseCode == "0"` + `ResultCode == "0"`). Eligible for settlement. |
| `"1032"` | `TRANSACTION_CONFIRMED_CANCELLED` | *Request cancelled by user.* | Subscriber explicitly dismissed/cancelled the SIM Toolkit prompt on handset before PIN authorization; terminal non-debit outcome documented in Daraja Lipa Na M-Pesa Online API. |
| `"1"` | `TRANSACTION_CONFIRMED_FAILED` | *The balance is insufficient for the transaction.* | M-Pesa core wallet balance check rejected the debit after PIN entry; terminal non-debit outcome documented in Daraja Lipa Na M-Pesa Online error catalogue. |
| `"1019"` | `TRANSACTION_CONFIRMED_FAILED` | *Transaction has expired.* | STK session TTL expired in M-Pesa core without completion; terminal non-debit outcome documented in Daraja Lipa Na M-Pesa Online error catalogue. |
| `"1037"` | `TRANSACTION_CONFIRMED_FAILED` | *DS timeout user cannot be reached.* | SIM Toolkit push / USSD session timed out reaching handset (e.g., SIM offline/out of coverage, STK menu outdated); no PIN entered and no debit executed. |
| `"2001"` | `TRANSACTION_CONFIRMED_FAILED` | *The initiator information is invalid.* | Subscriber entered an invalid M-Pesa PIN / authentication credentials rejected by M-Pesa core; terminal non-debit outcome documented in Daraja Lipa Na M-Pesa Online error catalogue. |

---

## Explicitly Excluded Codes (`QUERY_INCONCLUSIVE_RETRYABLE` → `RECONCILIATION_REQUIRED`)

| `ResultCode` | Classification | Daraja Meaning & Exclusion Rationale |
| :--- | :--- | :--- |
| `"1001"` | `QUERY_INCONCLUSIVE_RETRYABLE` | *Unable to lock subscriber, a transaction is already in process for the current subscriber.* **Excluded from terminal failure allowlist** per Prompt 33 Revision 3.3 Final Assessment: subscriber USSD/STK lock contention indicates another active session and is safely retried by the reconciliation worker; if still unresolved after 10 attempts, it transitions to `RECONCILIATION_REQUIRED` rather than silently failing an order. |
| `"1025"` | `QUERY_INCONCLUSIVE_RETRYABLE` | *An error occurred while sending a push request.* **Excluded from terminal failure allowlist**: represents an upstream push-broker dispatch error where query state is treated conservatively via retry + `RECONCILIATION_REQUIRED` escalation. |
| `"4999"` | `QUERY_INCONCLUSIVE_RETRYABLE` | *The transaction is still under processing.* Documented Daraja sandbox / gateway in-flight status; must remain `PROCESSING` and retry (`T-W1-MPESA-SBX-01`). |
| `"500.001.1001"` / non-zero `ResponseCode` | `QUERY_INCONCLUSIVE_RETRYABLE` | Upstream Daraja fault / pending query state; retried safely without terminal failure mutation. |
| Missing / `null` / `""` / Any other code | `QUERY_INCONCLUSIVE_RETRYABLE` | Fail-safe default (`T-W1-MPESA-CODE-01`): unknown or malformed codes never auto-fail or auto-cancel a payment. |
