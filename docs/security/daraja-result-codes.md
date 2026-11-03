# Safaricom Daraja Lipa Na M-Pesa Online (`stkpushquery/v1/query`) ResultCode Classification & Evidence Registry (`W1-AC-05`)

## 1. Purpose & Fail-Safe Verification Contract

All M-Pesa payment state transitions in `CommerceService` and `MpesaReconciliationWorker` rely on **server-to-server** `POST /mpesa/stkpushquery/v1/query` verification rather than unauthenticated webhook callbacks.

To guarantee that a legitimate customer debit is **never** falsely marked `FAILED` or `CANCELLED`, and an unverified query payload **never** settles an order:

1. **Transport & HTTP Gate**:
   - Network failures, `8_000 ms` request timeouts, HTTP `429`, and HTTP `5xx` responses without structured upstream `errorCode` classify as `QUERY_TRANSPORT_ERROR` (retryable).
   - Non-`200` HTTP responses carrying a structured Daraja `errorCode` (for example `500.001.1001` — *"The transaction is being processed"*) classify as `QUERY_INCONCLUSIVE_RETRYABLE`.
2. **Strict `ResponseCode === "0"` Gate (`isStrictDarajaResponseCodeZero`)**:
   - Both `DarajaClient.initiateStkPush` (`POST /mpesa/stkpush/v1/processrequest`) and `DarajaClient.queryStkPushStatus` (`POST /mpesa/stkpushquery/v1/query`) require the raw JSON `ResponseCode` field to be the exact string `"0"` (`typeof ResponseCode === "string" && ResponseCode === "0"`).
   - **No numeric coercion** (`0` is rejected) and **no whitespace trimming** (`" 0 "` is rejected).
   - Numeric `0`, `" 0 "`, missing `ResponseCode`, `null`, booleans (`false`, `true`), objects (`{}`), arrays (`[]`), empty strings (`""`), and all non-`"0"` strings (`"1"`, `"00"`, etc.) are rejected:
     - `initiateStkPush` throws `MpesaProviderError`.
     - `queryStkPushStatus` immediately returns `QUERY_INCONCLUSIVE_RETRYABLE` with `resultCode: null` without trusting or inspecting `ResultCode`.
3. **Primary-Evidence Closed `ResultCode` Allowlist**:
   - Only `ResultCode` outcomes backed by **primary Safaricom Daraja specification citations** (`https://developer.safaricom.co.ke/...`) or **committed, sanitized live-captured Daraja sandbox query JSON fixtures** (`docs/security/fixtures/daraja/...`) may trigger terminal payment state transitions.
   - Developer-authored prose, community forums, and third-party blog summaries are **prohibited** as evidence under the Prompt 33 Revision 3.3 Daraja ResultCode Evidence Addendum.
   - Any code lacking primary Safaricom specification or verified sandbox fixture evidence is **excluded** from `DARAJA_CONFIRMED_FAILURE_CODES` and classifies as `QUERY_INCONCLUSIVE_RETRYABLE`, escalating safely to `RECONCILIATION_REQUIRED` after 10 bounded attempts for human financial verification.

---

## 2. Included Outcomes (`DARAJA_RESULT_CODE_EVIDENCE`)

| `ResultCode` | Classification | Verbatim `ResultDesc` | Evidence Type & Primary Safaricom Reference | Non-Debit Finality & Settlement Semantics |
| :--- | :--- | :--- | :--- | :--- |
| `"0"` | `TRANSACTION_CONFIRMED_COMPLETED` | `"The service request is processed successfully."` | `SAFARICOM_PORTAL_SPEC` — Safaricom Daraja Developer Portal, *M-PESA Express (Lipa Na M-PESA Online) API Specification — Successful Result Sample* (`https://developer.safaricom.co.ke/apis/MpesaExpressSimulate`, paired with `https://developer.safaricom.co.ke/apis/MpesaExpressQuery` for `POST /mpesa/stkpushquery/v1/query`) | `nonDebitFinality: false`. Authoritative M-Pesa wallet debit completion (`ResponseCode === "0"` and `ResultCode === "0"`). Eligible for settlement; `verified_receipt_number` remains `NULL` unless corroborated by a verified receipt source because `stkpushquery/v1/query` does not return `MpesaReceiptNumber`. |
| `"1032"` | `TRANSACTION_CONFIRMED_CANCELLED` | `"Request cancelled by user"` | `SAFARICOM_PORTAL_SPEC` — Safaricom Daraja Developer Portal, *M-PESA Express (Lipa Na M-PESA Online) API Specification — Unsuccessful / Cancelled Result Sample* (`https://developer.safaricom.co.ke/apis/MpesaExpressSimulate`, paired with `https://developer.safaricom.co.ke/apis/MpesaExpressQuery` for `POST /mpesa/stkpushquery/v1/query`) | `nonDebitFinality: true`. Subscriber explicitly dismissed/cancelled the SIM Toolkit prompt on the handset prior to PIN entry; no wallet debit occurs. |

### Sanitized Reference Query Payloads (`POST /mpesa/stkpushquery/v1/query`)

**Completed (`ResultCode: "0"`):**
```json
{
  "ResponseCode": "0",
  "ResponseDescription": "The service request has been accepted successfully",
  "MerchantRequestID": "29115-34620561-1",
  "CheckoutRequestID": "ws_CO_191220191020363925",
  "ResultCode": "0",
  "ResultDesc": "The service request is processed successfully."
}
```

**User Cancelled (`ResultCode: "1032"`):**
```json
{
  "ResponseCode": "0",
  "ResponseDescription": "The service request has been accepted successfully",
  "MerchantRequestID": "29115-34620561-1",
  "CheckoutRequestID": "ws_CO_191220191020363925",
  "ResultCode": "1032",
  "ResultDesc": "Request cancelled by user"
}
```

---

## 3. Excluded Failure Candidates & Retryable Codes (`QUERY_INCONCLUSIVE_RETRYABLE` → `RECONCILIATION_REQUIRED`)

`DARAJA_CONFIRMED_FAILURE_CODES` is intentionally empty (`new Set([])`). Every code below is **excluded** from automatic `FAILED` / `CANCELLED` terminal transitions:

| `ResultCode` / Condition | Classification | Exclusion Rationale |
| :--- | :--- | :--- |
| `"1"`, `"1019"`, `"1037"`, `"2001"` (`DARAJA_EXCLUDED_UNVERIFIED_FAILURE_CANDIDATES`) | `QUERY_INCONCLUSIVE_RETRYABLE` | **Excluded under Prompt 33 Revision 3.3 Daraja ResultCode Evidence Addendum.** Safaricom's public `https://developer.safaricom.co.ke/apis/MpesaExpressSimulate` specification publishes official sample payloads only for `"0"` and `"1032"`, while `https://developer.safaricom.co.ke/apis/MpesaExpressQuery` gates authenticated interactive documentation behind portal login (`isAuthenticated: false`) and no live-captured Safaricom sandbox query fixtures exist in this repository. Because third-party developer blogs and developer-authored explanations are not admissible primary Safaricom evidence, these candidates remain retryable and escalate to `RECONCILIATION_REQUIRED` after 10 bounded attempts rather than risking unverified auto-failure. |
| `"1001"` | `QUERY_INCONCLUSIVE_RETRYABLE` | Subscriber USSD/STK lock contention indicates an active concurrent session; retried safely and escalated to `RECONCILIATION_REQUIRED` if unresolved after 10 attempts. |
| `"1025"` | `QUERY_INCONCLUSIVE_RETRYABLE` | Upstream push-dispatch error; treated conservatively via bounded retry + `RECONCILIATION_REQUIRED` escalation. |
| `"4999"` | `QUERY_INCONCLUSIVE_RETRYABLE` | In-flight STK processing state; must remain `PROCESSING` and retry (`T-W1-MPESA-SBX-01`). |
| `"500.001.1001"` / invalid or non-`"0"` `ResponseCode` | `QUERY_INCONCLUSIVE_RETRYABLE` | Upstream fault, pending query state, or malformed `ResponseCode` (`0`, `" 0 "`, `null`, `false`, `""`, `{}`, `[]`, `"1"`, `"00"`). |
| Missing / `null` / `""` / malformed / unknown `ResultCode` | `QUERY_INCONCLUSIVE_RETRYABLE` | Fail-safe default (`T-W1-MPESA-CODE-01`): unknown or malformed codes never auto-fail, auto-cancel, or settle a payment. |

---

## 4. Admission Procedure for Future `DARAJA_CONFIRMED_FAILURE_CODES` Additions

Before adding any code to `DARAJA_CONFIRMED_FAILURE_CODES`:

1. Obtain either (a) an authenticated official Safaricom Daraja portal specification export (`SAFARICOM_PORTAL_SPEC` on `https://developer.safaricom.co.ke/...`) or (b) a sanitized raw JSON response captured directly from `POST https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query` committed under `docs/security/fixtures/daraja/` (`VERIFIED_SANDBOX_FIXTURE`).
2. Record the exact `verbatimResultDesc`, `sanitizedQueryFixture` (with strict `"ResponseCode": "0"`), `nonDebitFinality: true`, and terminal non-debit justification in `DARAJA_RESULT_CODE_EVIDENCE` (`src/services/commerce/mpesa/daraja-client.ts`).
3. Ensure `assertValidDarajaEvidenceRegistry` and `T-W1-MPESA-ALLOWLIST-01` pass with individual outcome test coverage.
