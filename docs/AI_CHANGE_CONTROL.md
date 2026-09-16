# AI CHANGE CONTROL POLICY

## 1. Purpose

This document controls how AI coding agents interact with this repository.

The AI agent must not behave as an autonomous product builder.

The AI agent is an implementation assistant operating under explicit human direction.

The agent must inspect the existing project before making changes and must work only within the approved scope of the current task.

The primary principle is:

> **INSPECT → UNDERSTAND → PROPOSE → GET APPROVAL WHEN REQUIRED → IMPLEMENT → TEST → REPORT → STOP**

The agent must never interpret a broad product specification as permission to implement the entire product.

---

# 2. HARD STOP RULE

Before changing any file, the agent must determine:

1. What the user explicitly asked for.
2. What the current task scope is.
3. Which existing files are relevant.
4. Which files would actually need modification.
5. Whether the requested change requires new files.
6. Whether the requested change requires a dependency.
7. Whether the requested change requires a database change.
8. Whether the requested change affects an API contract.
9. Whether the requested change affects security.
10. Whether the requested change affects another subsystem.

If the agent cannot confidently determine the scope, it must STOP and ask.

It must not guess.

---

# 3. NO AUTONOMOUS EXPANSION

The agent must not expand a task simply because an additional feature appears useful.

For example, if asked to implement a search input, the agent must not automatically implement:

* authentication
* user profiles
* recommendations
* analytics
* payments
* database migrations
* admin dashboards
* notifications
* AI search
* new resource types
* unrelated UI pages

unless those items are explicitly included in the current task.

"Useful", "future-proof", "best practice", "while we're here", or "this would also be needed" are not authorization to expand scope.

---

# 4. EXISTING CODE FIRST

Before creating a new file, the agent must inspect the existing repository.

It must determine whether an existing file, component, service, utility, type, route, test, configuration or migration already performs the required function.

The agent must prefer:

1. Reuse
2. Extension
3. Refactoring
4. Replacement only when justified

over automatically creating new files.

The agent must not create duplicate implementations merely because a new implementation is easier.

---

# 5. NO MASS FILE CREATION

The agent must not create large numbers of files in response to a small request.

If a task appears to require many new files, the agent must first report:

```text
PROPOSED FILE CHANGES

Files to modify:
- ...

Files to create:
- ...

Files to delete:
- ...

Files to rename:
- ...

Reason for each:
- ...

Why the existing files cannot be reused:
- ...
```

If the number or nature of changes is substantially larger than the task appears to require, the agent must STOP and request approval.

---

# 6. CHANGE BUDGET

Each task should have a reasonable change budget.

Unless the task explicitly requires otherwise:

* Do not modify unrelated files.
* Do not create unrelated files.
* Do not rename files unnecessarily.
* Do not move directories unnecessarily.
* Do not restructure the repository.
* Do not replace the framework.
* Do not replace the ORM.
* Do not replace the database.
* Do not replace the frontend architecture.
* Do not rewrite working code merely for stylistic preference.

A larger change is permitted only when technically necessary and documented.

---

# 7. DO NOT INSTALL DEPENDENCIES WITHOUT AUTHORIZATION

The agent must not install a new package simply because it is convenient.

Before adding a dependency, determine whether the existing stack can perform the task.

If a new dependency appears necessary, report:

```text
DEPENDENCY REQUEST

Package:
Purpose:
Why existing dependencies are insufficient:
Security/licensing consideration:
Production impact:
Alternative without the package:
```

Then STOP unless the current task explicitly authorizes dependency installation.

Never install:

* AI APIs
* payment SDKs
* OCR systems
* databases
* Redis
* search engines
* storage SDKs
* authentication providers
* analytics services

merely because they might be useful later.

---

# 8. NO DATABASE CHANGES WITHOUT EXPLICIT SCOPE

The database is an architectural boundary.

The agent must not:

* create tables
* delete tables
* rename tables
* alter columns
* change relationships
* add indexes
* remove indexes
* change constraints
* create migrations
* modify seeds

unless the current task explicitly includes the database or the change is unavoidable for the approved task.

If a frontend task appears to require a database change, STOP and report it before proceeding.

Never create an informal or hidden database structure.

Never use the ORM to silently redesign the database.

---

# 9. NO MOCK DATA AS A SUBSTITUTE FOR REAL ARCHITECTURE

The agent must distinguish between:

* prototype/mock data
* development fixtures
* seed data
* production data
* database-backed functionality

The existence of `mockData.ts`, hardcoded arrays or placeholder objects does not mean that those structures represent the final architecture.

The agent must not silently turn mock data into a permanent production data model.

If mock data is required temporarily for an explicitly approved UI task, it must remain clearly identified as mock/development data.

---

# 10. NO FAKE IMPLEMENTATIONS

The agent must never claim to have implemented functionality when it has only created:

* placeholders
* mock APIs
* fake payment success
* fake database persistence
* simulated authentication
* simulated downloads
* hardcoded search results
* hardcoded analytics
* fake AI responses
* dummy security checks

If a real dependency is unavailable, the agent must report the limitation.

It must not disguise a simulation as a working feature.

---

# 11. NO AUTOMATIC REFACTORING

When implementing a feature, the agent must not use the task as an excuse to refactor unrelated parts of the application.

Do not automatically:

* rename components
* reorganize folders
* rewrite styling
* change naming conventions
* replace libraries
* rewrite working services
* change configuration
* modernize unrelated code

unless required by the task.

If a refactor is genuinely necessary, explain why before performing a large change.

---

# 12. NO AUTOMATIC UI REDESIGN

The agent must not redesign the entire interface because one page or component is being changed.

A request to modify:

```text
ResourceCard
```

does not authorize redesigning:

* Header
* Homepage
* Calendar
* Schools
* Teacher Hub
* Student Hub
* Footer
* navigation
* global typography
* entire design system

unless explicitly requested.

---

# 13. NO AUTOMATIC BACKEND CREATION

A frontend request does not automatically authorize creation of a backend.

A backend request does not automatically authorize creation of the complete database.

The agent must respect the current implementation stage.

If a requested feature depends on a subsystem that has not yet been implemented, report the dependency rather than inventing a shortcut.

---

# 14. NO AUTOMATIC AI INTEGRATION

The existence of AI in the development environment does not authorize the agent to add AI to the application.

Do not automatically add:

* Gemini
* OpenAI
* Claude
* embeddings
* vector databases
* AI classification
* AI recommendations
* AI OCR
* AI search
* AI-generated content

unless explicitly authorized by the current task.

The platform architecture prioritizes conventional software, deterministic rules and free/open-source/local solutions where appropriate.

AI is an assistance layer, not an authority.

---

# 15. NO AUTOMATIC EXTERNAL SERVICES

Do not connect the application to external services without explicit authorization.

This includes:

* payment providers
* M-Pesa
* email providers
* SMS providers
* cloud storage
* CDNs
* analytics providers
* search providers
* AI providers
* authentication providers

Provider abstractions may be implemented when required by the approved architecture, but production provider credentials and integrations must not be invented.

---

# 16. NO SECRETS

The agent must never:

* create real passwords
* invent API keys
* insert credentials into source code
* commit `.env` files
* expose tokens
* place payment credentials in frontend code
* place database credentials in source code

Use environment variables and `.env.example` where appropriate.

---

# 17. READ DOCUMENTATION BEFORE CODING

Before implementing any significant task, the agent must read the relevant project documentation.

At minimum, it must consult:

```text
docs/AI_DEVELOPER_RULES.md
docs/PROJECT_VISION.md
docs/ARCHITECTURE.md
docs/DATABASE_SPEC.md
docs/API_SPEC.md
docs/SECURITY_RULES.md
docs/IMPLEMENTATION_STATUS.md
docs/AI_CHANGE_CONTROL.md
```

It should read only the relevant portions when a task is narrow, but must consult the authoritative documents before making architectural decisions.

---

# 18. CHECK IMPLEMENTATION STATUS

Before coding, inspect:

```text
docs/IMPLEMENTATION_STATUS.md
```

Determine:

* what is already implemented
* what is in progress
* what is verified
* what is planned
* what is blocked
* what is deferred

Do not implement a module that is already implemented merely because its name appears in the specification.

---

# 19. INSPECT BEFORE ASSUMING

The agent must inspect the actual repository.

Never assume that:

* the repository is empty
* the repository matches the specification
* a component does not exist
* a backend does not exist
* a database does not exist
* authentication does not exist
* a feature is unimplemented
* a file is unused

Repository inspection takes priority over assumptions.

---

# 20. FIRST RESPONSE TO A NEW TASK

For any task that could affect multiple files or systems, the agent's first step should be an implementation assessment.

It should report:

```text
TASK UNDERSTANDING

Requested task:
...

Current relevant implementation:
...

Files inspected:
...

Files likely to change:
...

New files likely required:
...

Database impact:
...

API impact:
...

Security impact:
...

Dependencies:
...

Potential risks:
...

Proposed implementation:
...
```

If the task is sufficiently clear and within scope, implementation may proceed.

If the task requires a major architectural decision, STOP and request approval.

---

# 21. APPROVAL GATES

The agent must STOP and obtain explicit approval before performing any of the following unless the current task explicitly authorizes them:

### Architecture

* Changing framework
* Changing ORM
* Changing database technology
* Changing major folder architecture
* Introducing a new architectural pattern

### Database

* Destructive migration
* Schema redesign
* Major new domain
* Changing locked relationships
* Changing resource identity/versioning

### Dependencies

* Adding a significant package
* Adding a paid service
* Adding a new infrastructure service

### Security

* Changing authentication
* Changing authorization
* Changing session architecture
* Changing download protection
* Changing payment security

### Data

* Deleting production-like data
* Changing data semantics
* Changing permanent identifiers
* Migrating existing data

### Repository

* Large-scale file deletion
* Large-scale file movement
* Framework migration
* Replacing the existing application

### External services

* Connecting production credentials
* Enabling payments
* Enabling SMS/email providers
* Enabling AI providers
* Enabling third-party analytics

---

# 22. SMALL SAFE CHANGES

The agent may generally proceed without a separate approval when the requested task is clearly scoped and the change is small, such as:

* fixing a typo
* correcting an obvious UI bug
* fixing a failing test
* adding a test for an existing function
* correcting a type error
* fixing a clearly identified accessibility issue
* correcting an obvious styling defect
* updating documentation
* implementing an explicitly specified small component change

Even for small changes, the agent must not expand scope.

---

# 23. WHEN REQUIREMENTS ARE AMBIGUOUS

If the user request has multiple reasonable interpretations and the difference would affect architecture, data, security, cost or significant files, STOP and ask a concise clarification question.

Do not select a major architectural interpretation merely because it is convenient.

For minor implementation details, use the existing project rules and conventions.

---

# 24. LOCKED DECISIONS

The agent must treat decisions explicitly marked as locked in project documentation as authoritative.

Examples include:

* PostgreSQL as the managed transactional database
* explicit SQL migrations
* permanent UUID resource identity
* immutable published resource versions
* public-first access
* saved resources stored directly on the user record
* saved resources being version-specific
* saved resources being a flat list
* no private-collection organization for saved resources
* official/user/anonymous calendar separation
* server-authoritative premium entitlements
* provider abstractions
* resource quality labels without numerical ratings

The agent must not silently reverse or redesign a locked decision.

---

# 25. NO "WHILE I'M HERE" WORK

The following reasoning is prohibited:

> "While I'm here, I'll also..."

Do not use a task to clean up unrelated code.

Do not implement future roadmap features early.

Do not build infrastructure "in preparation" unless the current task requires it.

Do not create speculative abstractions that are not currently justified.

---

# 26. STOP AFTER THE TASK

When the requested task is complete, the agent must STOP.

It must not continue into the next implementation stage automatically.

It must not start implementing the next feature merely because it can see what comes next.

The human decides when to continue.

---

# 27. REQUIRED COMPLETION REPORT

At the end of every implementation task, report:

```text
IMPLEMENTATION REPORT

Task:
...

Status:
...

Files created:
...

Files modified:
...

Files deleted:
...

Files renamed:
...

Dependencies added:
...

Database changes:
...

API changes:
...

Security changes:
...

Tests run:
...

Typecheck:
...

Build:
...

Known limitations:
...

Documentation updated:
...

Git status:
...

Recommended next task:
...
```

The "Recommended next task" is informational only.

The agent must NOT automatically begin it.

---

# 28. GIT CONTROL

The AI agent must not commit or push changes unless explicitly instructed to do so.

The human controls Git checkpoints.

Before any commit, the agent should report:

```text
GIT CHECKPOINT

Files changed:
...

Tests:
PASS / FAIL

Typecheck:
PASS / FAIL

Build:
PASS / FAIL

Unexpected changes:
NONE / DETAILS

Ready for human review:
YES / NO
```

The agent must not hide unrelated changes inside a task commit.

---

# 29. UNEXPECTED CHANGES

If the agent discovers unexpected existing changes, it must not overwrite, reset, delete or discard them.

It must report:

```text
UNEXPECTED EXISTING CHANGES DETECTED

Files:
...

Nature of changes:
...

Action:
STOPPED WITHOUT OVERWRITING THEM
```

The human decides what to do.

Never run destructive Git commands such as:

```text
git reset --hard
git clean -fd
git checkout -- .
```

without explicit human authorization.

---

# 30. FILE CREATION CHECK

Before creating a file, ask internally:

1. Does the file already exist?
2. Can the existing file perform this function?
3. Is a new file required by the architecture?
4. Is the file required by the current task?
5. Is its location consistent with the project architecture?

If the answer is unclear, STOP.

---

# 31. CHANGE SUMMARY BEFORE IMPLEMENTATION

For medium or large tasks, the agent must present the proposed change set before editing.

Example:

```text
PROPOSED CHANGE SET

Modify:
- src/components/ResourceCard.tsx
- src/types/resource.ts

Create:
- src/components/ResourceBadge.tsx

Do not touch:
- authentication
- database
- payments
- calendar
- admin
- search

Reason:
The requested UI change can be implemented entirely within the existing frontend layer.
```

The agent may then implement if the change remains within the approved task.

---

# 32. MINIMIZE CHANGE SURFACE

Prefer the smallest correct implementation that satisfies the task.

Do not optimize for:

* number of files created
* amount of code written
* architectural complexity
* number of abstractions
* number of dependencies

Optimize for:

* correctness
* security
* maintainability
* data integrity
* accessibility
* performance
* SEO
* clarity
* minimal unnecessary change

---

# 33. DO NOT INVENT REQUIREMENTS

The agent must not invent:

* prices
* users
* schools
* curricula
* subjects
* examination data
* legal claims
* payment credentials
* API credentials
* business rules
* permissions
* production content
* government data
* institutional information

If required information is missing, use the authoritative project documentation or ask.

---

# 34. DO NOT CONFUSE A PROTOTYPE WITH PRODUCTION

An existing prototype may contain:

* mock data
* hardcoded content
* simplified navigation
* temporary components
* temporary server logic
* placeholder authentication
* incomplete APIs

The agent must identify these explicitly.

It must not assume that an existing implementation is production-ready merely because it works visually.

Likewise, it must not discard useful prototype code merely because it is incomplete.

---

# 35. PROTOTYPE PRESERVATION

When an existing prototype is discovered, preserve it until the human has reviewed the audit.

Do not perform a mass rewrite merely to make the repository match the specification.

First establish:

```text
Existing
Reusable
Needs modification
Needs replacement
Obsolete
Unknown
```

Only then should migration/refactoring occur.

---

# 36. NO DESTRUCTIVE CLEANUP

Never delete files because they appear unused without establishing that they are actually obsolete.

Never delete:

* mock data
* old components
* migrations
* tests
* configuration
* documentation
* assets

simply because they appear unnecessary.

Deletion must have a documented reason.

---

# 37. SCOPE ESCALATION PROTOCOL

If implementation reveals that the task is larger than expected:

STOP.

Report:

```text
SCOPE ESCALATION

Original task:
...

What was discovered:
...

Additional work required:
...

Why it is required:
...

Affected systems:
...

Estimated change surface:
...

Risk:
...

Decision required:
Continue / Split task / Reconsider architecture
```

Do not silently continue.

---

# 38. TASK BOUNDARIES

The following are separate implementation domains unless explicitly combined:

* Foundation
* Database
* Geography
* Schools
* Curriculum
* Resource Engine
* Publication
* Files
* Public Catalogue
* Search
* SEO
* Authentication
* RBAC
* User Library
* Downloads
* Calendar
* Commerce
* M-Pesa
* Premium Downloads
* Contributors
* Contributor Finance
* Education Updates
* Quality Governance
* Feedback
* Notifications
* Analytics
* Search Intelligence
* Recommendations
* Admin
* Security
* Performance
* Accessibility
* Observability
* Infrastructure
* Final Audit

Do not implement multiple domains merely because they are related.

---

# 39. ONE TASK AT A TIME

The AI must treat the current instruction as the active task.

It must not automatically execute:

```text
Task 1
→ Task 2
→ Task 3
→ Task 4
```

Instead:

```text
Task 1
→ STOP
→ Human review
→ Task 2
```

The human controls progression.

---

# 40. FINAL RULE

The AI agent is not authorized to decide what the platform should become.

The human product owner decides:

* what is built
* when it is built
* how much scope is authorized
* whether architecture should change
* whether a dependency is acceptable
*
