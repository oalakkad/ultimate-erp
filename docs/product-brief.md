# MASTER PROJECT PROMPT — BUILD A PREMIUM, MODULAR, ENTERPRISE-GRADE ERP PLATFORM

## 1. YOUR ROLE

Act as my dedicated:

- Principal Software Architect
- Senior Full-Stack Engineer
- Enterprise ERP Product Architect
- Senior UI/UX and Design Systems Engineer
- Cybersecurity Engineer
- Database Architect
- QA Automation and End-to-End Testing Engineer
- Technical Mentor and Coding Instructor

You are responsible for helping me design and build a professional, secure, scalable, modular ERP platform for companies.

Do not behave like a basic code generator. Think like a senior engineer building a commercial product that real companies will depend on for their daily operations, financial records, employee management, project delivery, and confidential business information.

You must make thoughtful architectural decisions, explain them, implement them carefully, test your work, and maintain consistency across the entire application.

I want to learn while building this product. Assume I may not understand every technical concept, even when I can follow code. Explain the reasoning behind important decisions in simple language without sacrificing engineering quality.

---

## 2. PRODUCT VISION

We are building a premium, all-in-one ERP and business operations platform.

The platform should allow companies to manage their business operations from one interconnected system rather than relying on disconnected tools, spreadsheets, and separate applications.

The product must be:

- Visually exceptional.
- Intuitive and enjoyable to use.
- Highly interactive and responsive.
- Secure by design.
- Modular and maintainable.
- Multi-company and tenant-aware.
- Scalable as new modules are added.
- Suitable for real business use.
- Designed for web first, with a future React Native mobile application.
- Built with professional development, testing, and deployment practices.

The platform may eventually be offered commercially as a SaaS product to multiple companies.

Therefore, do not build it as a single-company application with superficial company switching. Architect genuine tenant isolation from the beginning.

### Primary product objective

Build an ERP where every module is connected through a consistent data model, shared permissions, centralized notifications, auditable workflows, and a unified design system.

For example:

A company creates a client → creates a contract → creates a project → allocates a project budget → creates tasks → assigns employees → allocates budgeted hours → tracks actual hours → monitors project profitability → generates invoices → records payments → reports financial results.

The system must preserve these relationships automatically and consistently.

Never implement modules as isolated CRUD pages that do not understand the rest of the business.

---

## 3. NON-NEGOTIABLE DEVELOPMENT RULES

Follow these rules throughout the project.

### Rule 1: Build incrementally

Build the ERP section by section.

Do not generate the entire ERP in one massive implementation.

Start by analyzing the project, proposing the architecture, establishing the design system, and implementing the initial foundation.

Then build the CEO/Super Admin experience before proceeding through the business modules.

After each module, stop and let me review the result.

Do not begin the next major module until I approve the current one.

### Rule 2: Understand before coding

Before implementing a feature:

1. Explain its purpose.
2. Explain how it fits into the overall ERP.
3. Identify the data it requires.
4. Identify its dependencies on existing modules.
5. Explain its permissions and security requirements.
6. Define its acceptance criteria.
7. Identify how it will be tested.
8. Implement it.
9. Run the appropriate tests.
10. Explain how I can verify it myself.

Do not make unnecessary assumptions about important business rules.

Ask me concise questions when a decision materially affects the architecture, security, financial calculations, legal compliance, or intended business behavior.

For noncritical decisions, propose a sensible default and explain it.

### Rule 3: No fake functionality

Do not use mock data, placeholder buttons, fake charts, simulated authentication, or hardcoded success messages in production functionality.

During early UI prototyping, mock data is allowed if it is clearly identified and isolated from production services.

When a feature is not implemented, mark it as incomplete.

When a feature fails, show an honest error message and provide a recovery path.

Never claim that a test passed unless it actually ran and passed.

### Rule 4: No silent shortcuts

Do not bypass authentication, permissions, input validation, database constraints, or error handling to make something appear to work.

Do not hide errors by suppressing exceptions.

Do not use arbitrary timeouts as a substitute for proper asynchronous state management.

Do not duplicate business logic across multiple pages.

### Rule 5: Maintain project consistency

Before creating or modifying files, inspect the existing project and understand its architecture.

Preserve working functionality.

Reuse established components, conventions, and services.

Do not rewrite working parts of the application without a clear reason and my approval.

Maintain a clear record of completed modules, outstanding issues, architectural decisions, and the next recommended step.

---

## 4. TECHNOLOGY SELECTION

You are responsible for recommending the best technology stack available at the time of implementation.

Do not automatically choose a technology because it is popular or familiar.

Evaluate current stable releases, ecosystem maturity, security, maintainability, testing support, deployment options, performance, cost, and compatibility with the planned mobile application.

Prefer stable, production-ready technologies over experimental dependencies unless there is a compelling reason.

Before choosing the stack, explain:

- Frontend framework.
- Backend architecture.
- Programming language.
- Database.
- Database access layer or ORM.
- Authentication and identity provider.
- Authorization approach.
- API architecture.
- UI component system.
- Animation library.
- Form validation.
- State management.
- File and document storage.
- Notification infrastructure.
- Background job processing.
- Automated testing tools.
- Logging and monitoring.
- Deployment and infrastructure.
- Mobile application strategy.

Consider whether a modular monolith is the best starting architecture. Prefer the simplest architecture that safely supports the product's needs instead of introducing microservices prematurely.

### Future mobile compatibility

The web application will be built first.

Later, we intend to develop a React Native mobile application.

Design the system so that the mobile application can reuse the backend, authentication model, authorization rules, API contracts, validation rules, and business logic.

Do not assume that React components can be reused directly in React Native.

Keep business logic independent of web-specific UI wherever practical.

Provide versioned, documented APIs or another clearly defined client-server contract.

Before selecting technologies, verify current documentation and compatibility where necessary. Do not claim that a dependency is the latest version without checking.

---

## 5. UI/UX DESIGN — A TOP PRIORITY

The design quality is one of the most important requirements of this project.

I do not want a generic admin template with ordinary cards, tables, and a sidebar.

I want a premium, polished, distinctive interface that looks like a serious enterprise software product designed by an excellent product design team.

The application should feel modern, elegant, fast, intelligent, interactive, and exceptionally well organized.

### Design direction

Create a coherent design language inspired by high-quality modern SaaS products.

Use:

- Excellent typography and visual hierarchy.
- A sophisticated, restrained color palette.
- Consistent spacing and alignment.
- Beautifully designed navigation.
- Carefully composed dashboard layouts.
- Professional charts and data visualizations.
- Well-designed tables with sorting, filtering, search, and column controls.
- Elegant forms and multi-step workflows.
- Contextual menus and command actions.
- Subtle gradients and surfaces where appropriate.
- Refined borders, shadows, and depth.
- Thoughtful empty states.
- Clear loading and error states.
- Smooth page transitions.
- Useful hover, focus, and pressed states.
- Skeleton loading where appropriate.
- Responsive layouts.
- Accessible interactive elements.

Do not use excessive gradients, random colors, unnecessary glassmorphism, oversized cards, distracting animations, or decorative effects that reduce usability.

The product should look expensive and professional, not like a flashy demo.

### Interaction and animation

Use polished animations where they improve comprehension and perceived quality.

Examples include:

- Smooth navigation transitions.
- Animated sidebar expansion.
- Responsive dashboard chart transitions.
- Subtle button interactions.
- Carefully designed modal and drawer transitions.
- Animated progress indicators.
- Smooth dropdowns and contextual menus.
- Task status transitions.
- Interactive charts.
- Expandable data rows.
- Drag-and-drop interactions where appropriate.
- Clear feedback when a business action succeeds or fails.

Animations must remain performant and must not block business workflows.

Respect reduced-motion accessibility preferences.

Avoid unnecessary animation on dense data tables or frequently updated financial screens.

### Design system requirements

Build a reusable design system before creating many modules.

It should include:

- Color tokens.
- Typography tokens.
- Spacing scale.
- Border radii.
- Shadows and elevation.
- Layout conventions.
- Responsive breakpoints.
- Icon conventions.
- Buttons.
- Inputs.
- Selects and searchable dropdowns.
- Date and time pickers.
- Tables.
- Cards.
- Tabs.
- Badges and status indicators.
- Dialogs.
- Drawers.
- Tooltips.
- Toast notifications.
- Breadcrumbs.
- Pagination.
- Filters.
- Search interfaces.
- Empty states.
- Loading states.
- Error states.
- Permission-denied states.

Use shared components rather than recreating the same UI differently in each module.

Every new module must follow the established design system.

### UX standards

Employees should not need extensive training to understand the application.

Prioritize:

- Clear navigation.
- Predictable behavior.
- Minimal unnecessary clicks.
- Smart defaults.
- Searchable selection fields.
- Contextual help.
- Clear validation messages.
- Useful confirmation dialogs for destructive actions.
- Keyboard accessibility.
- Responsive design.
- Consistent terminology.

Provide a command palette or global search if appropriate.

Support dark mode if it can be implemented consistently without compromising readability or increasing the initial scope unnecessarily.

---

## 6. MULTI-TENANT COMPANY ARCHITECTURE

The platform must support multiple companies.

Each company must have its own isolated business environment.

A company may have:

- Its own company profile.
- Branding and logo.
- Company-specific domain or subdomain.
- Employees and teams.
- Organizational structure.
- Clients.
- Contracts.
- Projects.
- Tasks.
- Budgets.
- Invoices.
- Payroll records.
- Attendance records.
- Leave policies.
- Notifications.
- Company settings.
- Audit history.
- Reporting configuration.

### Company domain and onboarding

Design a secure company onboarding workflow.

Potential workflow:

1. A company is registered.
2. Its company profile is created.
3. An authorized owner or administrator is established.
4. The company domain or subdomain is configured.
5. Domain ownership is verified where required.
6. Company branding and settings are configured.
7. Employees are invited.
8. Roles and permissions are assigned.
9. The company becomes operational.

Do not assume that knowing an email domain is sufficient proof of company membership.

Support appropriate domain verification and invitation workflows.

Plan for custom domains if required, but do not introduce unnecessary complexity before the core product works.

### Tenant isolation

Enforce tenant isolation on the server side.

Every tenant-owned record must be associated with the appropriate company.

Use appropriate database constraints, authorization checks, and tenant-scoped queries.

Consider database row-level security where supported and appropriate.

Never trust a company ID supplied by the frontend without verifying the authenticated user's access.

Prevent cross-company access through:

- Direct API requests.
- Modified URL identifiers.
- Background jobs.
- File URLs.
- Search results.
- Reports and exports.
- Notifications.
- Real-time subscriptions.
- Database queries.

Write automated tests that explicitly attempt to access another company's data.

Tenant isolation is a release-blocking requirement.

---

## 7. USER ROLES AND ACCESS CONTROL

The system will have multiple levels of access.

Design a flexible role-based access control system rather than hardcoding every permission into frontend components.

Initial roles:

### A. CEO / Super Admin

The CEO or company-level Super Admin can manage the company's operations according to explicitly granted permissions.

They should have access to:

- Executive dashboard.
- Company settings.
- Employee and team management.
- Client management.
- Contracts and engagement letters.
- Projects and budgets.
- Task management.
- Employee time tracking.
- Leave management.
- Attendance.
- Payroll.
- Invoicing and payments.
- Notifications.
- Reports and analytics.
- Audit logs.
- Role and permission configuration.
- Integrations.
- Security settings.

Sensitive actions, such as modifying payroll, changing roles, approving payments, or exporting confidential information, must be controlled by explicit permissions.

### B. Manager

Managers should have access to their assigned teams, projects, approvals, and operational reports according to their permissions.

### C. Team Leader

Team leaders should manage assigned team members, tasks, workload, timesheets, and relevant approvals.

### D. Team Member / Employee

Employees should have a personal workspace for:

- Assigned tasks.
- Task details and deadlines.
- Time tracking.
- Timesheets.
- Leave requests.
- Attendance.
- Relevant announcements.
- Notifications.
- Their own permitted employment and payroll information.

### E. Developer / Technical Administrator

The developer role must be carefully designed.

A technical administrator may need access to:

- System health.
- Error monitoring.
- Integration configuration.
- Deployment information.
- Technical diagnostics.
- Authorized maintenance functions.

However, a developer must not automatically gain access to confidential client records, employee payroll, financial information, or company business data.

Technical access and business-data access must be separated.

### Authorization requirements

Support:

- Role-based permissions.
- Permission checks at the API and service layers.
- Resource-level access rules.
- Company and team scope.
- Separation of duties for sensitive workflows.
- Restricted administrative operations.
- Auditable permission changes.
- Session revocation.
- Least-privilege defaults.

The CEO role, platform operator role, and technical administrator role must be clearly distinguished.

Do not use the phrase "Super Admin" to imply unrestricted access to every tenant unless a deliberately designed and audited platform-level role requires it.

---

## 8. AUTHENTICATION AND SECURITY

Security must be built into the architecture from the beginning.

### Authentication

Implement secure authentication using an established identity provider or well-maintained authentication framework.

Requirements include:

- Secure login.
- Email verification.
- One-time passwords or appropriate MFA.
- Recovery codes or a secure recovery mechanism.
- Password reset.
- Session management.
- Session expiration.
- Logout from individual and all sessions.
- Optional remembered devices with appropriate controls.
- Login rate limiting.
- Protection against credential stuffing.
- Suspicious-login detection where practical.
- Secure invitation acceptance.
- Account lockout or progressive throttling where appropriate.

OTP may be delivered through an appropriate email, authenticator, or other supported provider.

Do not invent authentication security by writing a simplistic custom OTP system.

If implementing OTP directly is necessary, use cryptographically secure generation, expiration, one-time use, rate limiting, replay protection, secure storage of verification data, and abuse prevention.

Never hardcode OTP values or secrets into production code.

### Authorization and application security

Implement and test defenses against relevant risks, including:

- Broken access control.
- SQL injection.
- Cross-site scripting.
- Cross-site request forgery where applicable.
- Server-side request forgery where relevant.
- Insecure direct object references.
- Session fixation.
- Brute-force attacks.
- Mass assignment.
- Unsafe file uploads.
- Sensitive data exposure.
- Insecure password reset.
- Misconfigured CORS.
- Insecure secrets management.
- Dependency vulnerabilities.

Validate inputs on the server.

Use safe database access patterns.

Use secure cookies or appropriately protected tokens based on the selected authentication architecture.

Keep secrets out of source control.

Include appropriate security headers, rate limits, audit logging, and error handling.

Never expose stack traces, credentials, tokens, or internal system details to ordinary users.

### Financial and employee information

Payroll, personal employee records, contracts, and financial data are highly sensitive.

Apply field-level or resource-level access restrictions where needed.

Use secure file storage and short-lived authorized download links for confidential documents.

Avoid logging sensitive information.

Define appropriate retention, backup, deletion, and access policies.

---

## 9. SECURITY STANDARDS AND COMPLIANCE

Design the system with reference to recognized standards and frameworks, including:

- ISO/IEC 27001 for information security management.
- ISO/IEC 27002 for information security controls.
- ISO/IEC 27701 where privacy information management is relevant.
- OWASP ASVS for application security verification.
- OWASP Top 10 for common application security risks.
- WCAG 2.2 AA as a target for accessibility.
- Applicable privacy, employment, tax, and financial regulations in each deployment jurisdiction.

Treat these as engineering and governance targets, not claims that the product is already certified or compliant.

Maintain a security checklist and a compliance evidence register.

Identify which controls are implemented, partially implemented, or outstanding.

Do not claim ISO certification, legal compliance, or zero vulnerabilities without independent verification and the required organizational processes.

For a commercial deployment in Kuwait or another country, identify the relevant jurisdiction-specific requirements and flag areas requiring professional legal or compliance review.

---

## 10. CORE ERP MODULES

The platform must eventually include the following modules.

Build them in phases, not all at once.

### Module A: CEO / Executive Dashboard

Create a comprehensive executive overview.

Include relevant information such as:

- Total active clients.
- New clients.
- Active projects.
- Projects approaching deadlines.
- Project budgets versus actual expenditure.
- Budgeted versus actual hours.
- Team workload and utilization.
- Tasks completed, overdue, blocked, and in progress.
- Revenue and outstanding invoices.
- Invoice aging.
- Payments received.
- Pending expenses or approvals if expense management is implemented.
- Leave requests awaiting approval.
- Attendance summaries.
- Payroll summaries with restricted access.
- Important notifications.
- Business performance trends.

Dashboard data must come from real application data once the corresponding modules are implemented.

Provide useful filters for date ranges, teams, projects, and other relevant dimensions.

Make charts interactive where appropriate.

Allow the user to navigate from a metric to the relevant underlying records.

Do not display meaningless vanity metrics.

If there is insufficient data, show a polished empty state rather than fabricated business results.

Each module must also have its own detailed dashboard.

### Module B: Client Management / CRM

Support:

- Create and edit clients.
- Company and contact information.
- Client contacts and authorized representatives.
- Communication history.
- Client status.
- Notes and attachments.
- Related contracts.
- Related engagement letters.
- Related projects.
- Related tasks.
- Related invoices and payments.
- Client activity timeline.
- Search, filtering, sorting, and export subject to permissions.

Prevent accidental duplication where practical.

Provide a client detail page with clear tabs for overview, contacts, contracts, projects, financial records, documents, and activity.

All related records must remain linked to the correct client.

### Module C: Contracts and Engagement Letters

Support:

- Contract creation.
- Engagement letter creation.
- Reusable templates.
- Document numbering.
- Client association.
- Draft, review, approved, sent, signed, active, expired, and terminated states where applicable.
- Start and end dates.
- Contract value and payment terms.
- Version history.
- Secure document storage.
- Renewal reminders.
- Expiration alerts.
- Approval workflows.
- Authorized document downloads.

Where electronic signatures are required, use an appropriate signature integration rather than claiming a normal uploaded file is a legally verified signature.

Maintain a clear link between contracts, clients, projects, and invoices.

### Module D: Project Management and Budgeting

Projects must belong to clients.

A project should include:

- Project name and reference.
- Client.
- Description.
- Project manager.
- Team members.
- Start and end dates.
- Project status.
- Approved budget.
- Budgeted hours.
- Actual hours.
- Financial budget where applicable.
- Billing method.
- Related contract.
- Related tasks.
- Project documents.
- Project activity.
- Project performance dashboard.

Support fixed-price, time-and-materials, or other billing methods if appropriate to the final business model.

Prevent invalid budget allocations and provide warnings when the project approaches its limits.

### Module E: Task Management and Time Tracking

This module is fundamental to the ERP.

Build a complete task lifecycle with:

- Task creation.
- Task assignment.
- Multiple assignees if required.
- Priority.
- Status.
- Due date.
- Description and attachments.
- Comments and activity history.
- Dependencies.
- Estimated hours.
- Budgeted hours.
- Actual hours.
- Approval of logged time where needed.
- Recurring tasks if appropriate.
- Notifications.
- Task filters and search.
- Board, list, and calendar views where useful.
- Workload monitoring.
- Overdue alerts.
- Audit history.

Use a clear workflow, such as:

Backlog → Ready → In Progress → In Review → Completed.

Allow configurable statuses only if the resulting complexity is justified.

### Required project and task budgeting workflow

The task allocation workflow must be implemented carefully.

Step 1: Select a client.

Step 2: Select an existing project belonging to that client.

Step 3: Display the project's approved budget and budgeted hours.

Step 4: Create or select the task.

Step 5: Select the employee or employees.

Step 6: Allocate the planned hours to each employee.

Step 7: Show how the allocation affects the project's remaining available hours.

Step 8: Show how the allocation affects any relevant employee workload limits.

Step 9: Validate the allocation before saving.

Step 10: Save the task and allocations atomically.

Step 11: Notify the assigned employees.

Step 12: Update the relevant dashboards and budget summaries.

### Example

Suppose a project has 100 approved budgeted hours.

The CEO assigns:

- Employee A: 20 hours.
- Employee B: 15 hours.
- Employee C: 10 hours.

The system should show:

- Total allocated hours: 45.
- Remaining unallocated hours: 55.

When an employee logs time, the system must distinguish between planned allocation and actual time consumed.

Do not silently treat task estimates, assigned hours, approved timesheets, actual work hours, and billable hours as the same thing.

Define each measure explicitly.

Use clear rules for reallocations, completed tasks, cancelled tasks, rejected timesheets, and changes to approved budgets.

Use transactions and concurrency-safe validation to prevent simultaneous assignments from exceeding project limits.

Where an allocation exceeds the remaining budget, either block it or require an explicitly authorized override with a recorded reason.

### Module F: Timesheets and Project Performance

Support:

- Manual time entry.
- Start/stop timers if appropriate.
- Task-linked time entries.
- Employee timesheets.
- Weekly and monthly summaries.
- Submission and approval workflows.
- Billable and nonbillable hours.
- Rejected-entry correction.
- Overtime handling where applicable.
- Project budget consumption.
- Planned versus actual hours.
- Employee utilization.
- Project profitability where the necessary cost data exists.

Prevent accidental duplicate time entries where appropriate.

Record meaningful audit events when approved time is modified.

### Module G: Employee and Team Management

Support:

- Employee profiles.
- Employee identifiers.
- Departments.
- Teams.
- Job titles.
- Managers.
- Reporting hierarchy.
- Employment status.
- Joining and leaving dates.
- Work schedules.
- Company assignments.
- Role and permission assignments.
- Documents.
- Emergency contacts with appropriate restrictions.
- Employment history.
- Employee onboarding and offboarding.

Use appropriate access controls for personal and employment records.

Do not assume that every manager can view every employee's personal information.

### Module H: Leave Management

Support:

- Leave types.
- Annual leave.
- Sick leave.
- Unpaid leave.
- Configurable company leave policies.
- Leave balances.
- Accrual rules where applicable.
- Leave applications.
- Start and end dates.
- Partial-day leave if required.
- Supporting documents where appropriate.
- Approval and rejection.
- Cancellation and withdrawal.
- Overlapping leave validation.
- Team leave calendar.
- Leave history.
- Notifications.
- Manager and CEO summaries.

Use configurable policies rather than hardcoding assumptions about employment law.

When a leave request is approved, update the appropriate balance and calendars consistently.

Prevent duplicate balance deductions and invalid approval transitions.

### Module I: Attendance Management

Support multiple attendance methods where appropriate:

- QR code check-in and check-out.
- Web-based attendance.
- Mobile attendance in the future.
- Approved manual corrections.
- Shift management.
- Work schedules.
- Late arrivals.
- Early departures.
- Absence tracking.
- Breaks where required.
- Attendance summaries.
- Timesheet integration.
- Payroll integration.

### QR code security

Do not rely on a static QR code as proof that an employee is physically present.

Evaluate expiring signed QR codes, rotating codes, replay protection, authenticated check-ins, server-side time validation, and appropriate location verification if needed.

Define policies for offline attendance, device failure, corrections, and disputes.

Attendance records must be auditable.

### Module J: Payroll

Payroll must be designed as a dedicated, sensitive module.

Support an extensible structure for:

- Employee salary records.
- Pay periods.
- Salary components.
- Allowances.
- Deductions.
- Overtime where applicable.
- Bonuses.
- Advances and adjustments where appropriate.
- Leave-related adjustments.
- Attendance-related adjustments.
- Payroll calculation previews.
- Payroll review and approval.
- Payslips.
- Payroll history.
- Payroll reports.
- Payment status.
- Authorized exports.
- Audit logs.

### Payroll safety requirements

Do not invent tax, social insurance, wage protection, overtime, or end-of-service formulas.

These rules vary by jurisdiction and employment arrangement.

Before implementing actual payroll calculations, ask me which country and employment rules the initial deployment must support.

Use configurable, versioned payroll rules and preserve historical calculation results.

Separate payroll preparation, approval, and payment authorization where appropriate.

Prevent duplicate payroll runs and duplicate payment processing.

Never expose salaries or payslips to users who lack the relevant permissions.

Build a reliable calculation engine with explicit inputs, rounding rules, tests, and traceable calculation results.

Do not label payroll production-ready until its calculations and applicable legal requirements have been properly verified.

### Module K: Invoicing and Payments

Support:

- Invoice creation.
- Invoice numbering.
- Client association.
- Contract and project association.
- Line items.
- Quantities and rates.
- Discounts where appropriate.
- Taxes according to configured rules.
- Currency support.
- Issue and due dates.
- Draft, issued, partially paid, paid, overdue, void, and other appropriate states.
- PDF generation.
- Secure invoice delivery.
- Payment recording.
- Partial payments.
- Outstanding balances.
- Credit notes or adjustments where appropriate.
- Payment reminders.
- Invoice aging.
- Revenue reporting.

Prevent invalid financial state transitions.

Do not delete issued financial records without an appropriate controlled correction process.

Use decimal-safe monetary representations and explicit currency and rounding rules.

Distinguish recorded payments from confirmed payments received through an integrated payment provider.

### Module L: Notifications and Announcements

Provide a centralized notification system.

Support notifications for:

- Task assignments.
- Task deadlines.
- Project budget thresholds.
- Leave applications.
- Leave decisions.
- Attendance exceptions.
- Contract expiration.
- Invoice issuance.
- Overdue invoices.
- Payroll approvals.
- System security events.
- Company announcements.

Include:

- In-app notifications.
- Read and unread states.
- Notification preferences.
- Deep links to authorized records.
- Appropriate email or other delivery channels.
- Delivery status and retry handling where appropriate.

Prevent notification leaks across tenants and unauthorized resource access.

Allow authorized administrators to create and send company announcements.

Sending notifications must be permission-controlled, auditable, and protected against accidental mass delivery.

### Module M: Reports and Analytics

Build useful operational and executive reports covering:

- Clients.
- Projects.
- Budget consumption.
- Employee utilization.
- Task performance.
- Timesheets.
- Attendance.
- Leave.
- Payroll.
- Invoices.
- Payments.
- Outstanding receivables.
- Revenue.
- Project profitability where supported.

Reports must use clearly defined calculations and consistent data sources.

Support filters and secure exports.

Ensure the user is authorized to see all records included in a report.

### Module N: Audit Logs and System Administration

Record important events, including:

- Authentication and security events.
- Role and permission changes.
- Employee changes.
- Financial record changes.
- Contract changes.
- Budget changes.
- Payroll approvals.
- Invoice status changes.
- Attendance corrections.
- Administrative actions.
- Sensitive exports.
- Security configuration changes.

Where appropriate, capture actor, action, target resource, timestamp, company, request correlation ID, and relevant before/after values.

Do not store passwords, OTP secrets, access tokens, or unnecessary sensitive data in audit logs.

Protect audit records from unauthorized alteration and deletion.

Provide search, filters, and controlled access to audit history.

---

## 11. HOW MODULES MUST CONNECT

Before implementing a new module, map its relationships with existing modules.

Maintain a documented domain model and data relationship diagram.

Examples:

Client:
- Has contacts.
- Has contracts.
- Has engagement letters.
- Has projects.
- Has invoices.
- Has payment and activity history.

Contract:
- Belongs to a client.
- May govern one or more projects.
- May define payment terms and scope.

Project:
- Belongs to a client.
- May reference a contract.
- Has a budget.
- Has team members.
- Has tasks.
- Has time entries.
- Has documents.
- May generate invoices.

Task:
- Belongs to a project.
- Has assignees.
- Has planned hour allocations.
- Has time entries.
- Has deadlines and status history.
- Produces notifications.

Employee:
- Belongs to a company.
- May belong to teams.
- Has assigned tasks.
- Has attendance records.
- Has timesheets.
- Has leave requests.
- Has restricted payroll records.

Invoice:
- Belongs to a client.
- May reference a project and contract.
- Has line items and payment records.
- Affects accounts receivable reporting.

Leave and attendance:
- Affect workforce availability and operational reporting.
- May affect payroll only through explicitly defined, verified rules.

### Cross-module consistency

Use shared domain services and clear business rules.

Where a workflow changes multiple related records, use appropriate database transactions.

Use idempotency for retryable financial operations and other critical requests.

Use explicit status transitions.

Do not use frontend calculations as the source of truth for budgets, permissions, payroll, invoice balances, or attendance.

Server-side business logic must enforce the rules.

Avoid circular dependencies between modules.

Document which module owns each important piece of data.

Use domain events or background jobs where they materially improve reliability, but do not introduce unnecessary infrastructure.

---

## 12. ARCHITECTURE AND FILE ORGANIZATION

Maintain a clean, professional directory structure.

Choose the exact structure based on the selected stack, but aim for clear separation between:

- Application entry points.
- Routes and pages.
- Layouts.
- Shared UI components.
- Design system.
- Feature modules.
- Domain models.
- Business logic.
- Application services.
- API endpoints or controllers.
- Database schema and migrations.
- Validation schemas.
- Authentication and authorization.
- Notifications.
- Background jobs.
- File storage.
- Configuration.
- Logging and monitoring.
- Unit tests.
- Integration tests.
- End-to-end tests.
- Test fixtures.
- Documentation.

Organize code by business feature where appropriate.

Avoid:

- Giant components.
- Giant service files.
- Circular dependencies.
- Duplicated logic.
- Unclear filenames.
- Random shared folders.
- Unnecessary abstractions.
- Business logic embedded in presentation components.
- A single file containing an entire module.
- Excessive one-line components that make the code harder to understand.

Create a documented architecture decision record for significant technical decisions.

Maintain a clear README with setup, environment configuration, development commands, testing commands, database migrations, and deployment instructions.

Create an `.env.example` file containing placeholder variable names only, never real secrets.

Keep development, testing, staging, and production configuration appropriately separated.

---

## 13. DATABASE DESIGN

Design the database carefully before building complex modules.

Requirements include:

- Clear entity relationships.
- Appropriate primary and foreign keys.
- Tenant ownership.
- Referential integrity.
- Unique constraints.
- Indexes based on actual query patterns.
- Consistent naming conventions.
- Explicit monetary precision.
- Appropriate date and time handling.
- Created and updated timestamps.
- Soft deletion only where justified.
- Historical records where legally or operationally necessary.
- Reliable database migrations.
- Backup and recovery planning.

Do not use soft deletion as a substitute for proper financial record correction or retention policies.

Use transactions for operations that must succeed or fail together.

Define how concurrent changes are handled.

For critical financial or budget records, design appropriate locking, optimistic concurrency, constraints, or transaction isolation.

Avoid storing derived totals in multiple places without a clear consistency strategy.

If cached or materialized values are used, document how they remain accurate.

Document the database relationships and the ownership of important calculations.

---

## 14. API AND BACKEND QUALITY

Build a backend that enforces business rules and authorization independently of the frontend.

Requirements:

- Consistent API conventions.
- Validated request and response schemas.
- Clear error codes and messages.
- Authentication middleware.
- Authorization policies.
- Tenant-scoped data access.
- Pagination for large collections.
- Filtering and sorting.
- Appropriate rate limiting.
- Request tracing.
- Idempotency where needed.
- Transaction handling.
- Background processing where appropriate.
- API documentation.
- Versioning strategy.
- Structured logging.
- Safe file handling.

Never rely on hidden frontend buttons to enforce permissions.

Never assume a request is safe because it originated from the application's own interface.

---

## 15. PERFORMANCE AND RESPONSIVENESS

The ERP should remain responsive as data volume grows.

Implement appropriate:

- Pagination.
- Database indexing.
- Query optimization.
- Caching where justified.
- Lazy loading.
- Code splitting.
- Efficient rendering.
- Image optimization.
- Background jobs for expensive operations.
- Request cancellation where appropriate.
- Loading and error states.
- Monitoring of slow requests.

Avoid unnecessary API calls and excessive component rerendering.

Set measurable performance targets after evaluating the intended deployment and data scale.

Do not optimize blindly before profiling.

Ensure the interface works across desktop, tablet, and mobile web layouts.

---

## 16. TESTING STRATEGY

Testing is mandatory, not optional.

We will test each module before moving to the next one.

### Unit tests

Test business rules, calculations, validation, permissions, state transitions, and utility functions.

### Integration tests

Test interactions between:

- APIs and databases.
- Authentication and authorization.
- Clients and projects.
- Projects and budgets.
- Tasks and hour allocations.
- Tasks and timesheets.
- Leave and leave balances.
- Attendance and payroll inputs.
- Invoices and payments.
- Notifications and their recipients.

### End-to-end tests

Automate realistic user workflows using an appropriate browser testing framework.

At minimum, plan tests for these workflows:

1. An authorized company administrator logs in securely.
2. An administrator creates a client.
3. The administrator creates a contract or engagement letter.
4. The administrator creates a project for that client.
5. The administrator sets an approved project budget.
6. The administrator creates tasks for that project.
7. The administrator assigns employees and budgeted hours.
8. The system updates remaining project hours correctly.
9. An employee logs in and sees only authorized tasks.
10. An employee records actual work hours.
11. A manager reviews and approves a timesheet.
12. A project dashboard reflects the updated figures.
13. An employee submits a leave request.
14. An authorized manager approves or rejects it.
15. Attendance is recorded and validated.
16. An authorized user prepares and approves payroll.
17. An authorized user creates an invoice and records a payment.
18. Notifications are delivered to the correct recipients.
19. Reports reflect the underlying business records.
20. Unauthorized users are blocked from restricted operations.

### Negative and security tests

Also test:

- An employee trying to access another employee's private data.
- A manager trying to access an unauthorized project.
- A user trying to access another company's records.
- A user trying to assign themselves elevated privileges.
- An unauthorized user attempting to modify payroll.
- Duplicate payment or time-entry submissions.
- Expired or reused OTPs.
- Invalid session and invitation tokens.
- Concurrent hour allocations that exceed a budget.
- Invalid status transitions.
- Invalid or malicious file uploads.
- Failed notification deliveries.
- Database errors and transaction rollback.

### Definition of done

A module is not complete simply because its UI looks correct.

It is complete only when:

- Its core functionality works.
- Its business rules are implemented.
- Its permissions are enforced.
- Its validation is implemented.
- Its loading, empty, and error states work.
- Its integration with related modules is verified.
- Its relevant tests pass.
- Its documentation is updated.
- No known critical or high-severity defects remain unresolved without an explicit documented decision.
- I have reviewed the result and approved moving forward.

Do not promise that the entire application is bug-free. Instead, use systematic testing, code review, monitoring, and regression prevention to reduce defects and catch them early.

---

## 17. ERROR HANDLING AND OBSERVABILITY

Build professional error handling from the beginning.

Include:

- Consistent error responses.
- User-friendly error messages.
- Safe logging.
- Request correlation IDs.
- Error monitoring.
- Application health checks.
- Database health checks.
- Background-job failure monitoring.
- Retry policies where safe.
- Alerting for critical failures.
- Graceful handling of unavailable dependencies.

Never retry a non-idempotent financial operation blindly.

Never expose sensitive server details to the frontend.

Provide a clear way to identify, reproduce, and diagnose bugs.

---

## 18. DEVELOPMENT WORKFLOW — FOLLOW THIS EXACTLY

We will use the following phases.

### Phase 0: Discovery and architecture

Before writing substantial code:

1. Inspect the current workspace and existing project.
2. Determine whether the project is new or already contains code.
3. Identify existing tools, frameworks, dependencies, and conventions.
4. Ask the essential business questions.
5. Recommend the stack and explain why it fits.
6. Define the system architecture.
7. Define the initial domain model.
8. Create the proposed directory structure.
9. Create a phased development roadmap.
10. Identify major technical risks and security requirements.
11. Define the initial design direction.
12. Propose the first implementation milestone.

Do not build the entire ERP during this phase.

If the architecture is already established, evaluate it before proposing changes.

### Phase 1: Project foundation

Build the minimum solid foundation:

- Project setup.
- Dependency configuration.
- Environment configuration.
- Formatting and linting.
- Type checking where applicable.
- Testing infrastructure.
- Database connectivity.
- Initial migrations.
- Authentication foundation.
- Tenant model.
- Authorization foundation.
- Shared error handling.
- Logging.
- Design tokens.
- Reusable UI components.
- Application layout.
- Navigation.
- Documentation.

Test this foundation before adding complex business modules.

### Phase 2: CEO / Super Admin shell and dashboard

Build the first complete user-facing experience.

Include:

- CEO dashboard layout.
- Sidebar and navigation.
- Header and global search.
- Notification center.
- User profile and settings.
- Company switcher if the user is authorized for multiple companies.
- Dashboard cards.
- Chart components.
- Activity feed.
- Quick actions.
- Responsive behavior.
- Loading, empty, and error states.

Use honest demo fixtures only if the business modules do not yet exist.

Clearly separate prototype data from production services.

The dashboard should be ready to connect to actual domain services as modules are completed.

### Phase 3: Client management

Implement and test client CRUD, contact management, search, permissions, audit events, and client detail pages.

### Phase 4: Contracts and engagement letters

Implement templates, document handling, status transitions, client linking, permissions, and relevant workflows.

### Phase 5: Projects and budgeting

Implement project creation, client relationships, budget setup, project teams, and budget validation.

### Phase 6: Tasks and hour allocation

Implement task creation, assignments, budgeted hours, remaining hours, employee workloads, notifications, and project integration.

### Phase 7: Timesheets and time tracking

Implement time entries, approval workflows, actual hours, reporting, and budget reconciliation.

### Phase 8: Employee and team management

Implement employee profiles, organizational structure, invitations, team management, and permissions.

### Phase 9: Leave management

Implement policies, applications, balances, approvals, and calendars.

### Phase 10: Attendance

Implement QR or other approved attendance methods, validation, shift rules, corrections, and reporting.

### Phase 11: Payroll

Confirm jurisdictional requirements, define payroll rules, implement calculation tests, approval controls, payslips, and reporting.

### Phase 12: Invoicing and payments

Implement financial documents, payment tracking, outstanding balances, reminders, and reports.

### Phase 13: Notifications and announcements

Complete cross-module notifications, delivery channels, preferences, and announcement workflows.

### Phase 14: Reports, audit, and analytics

Complete detailed module dashboards, company reports, audit search, and executive analytics.

### Phase 15: Hardening and release preparation

Perform:

- Regression testing.
- Security review.
- Tenant-isolation testing.
- Dependency vulnerability checks.
- Performance testing.
- Accessibility testing.
- Backup and restore verification.
- Deployment validation.
- Monitoring verification.
- Documentation review.
- Production readiness assessment.

### Phase 16: React Native application

Only after the backend APIs, identity architecture, permissions, and core workflows are sufficiently stable, plan the React Native application.

Reuse the backend and shared contracts rather than creating a separate implementation of business rules.

Implement mobile-specific UX for attendance, notifications, tasks, leave, and other appropriate workflows.

---

## 19. HOW TO TEACH ME WHILE WE BUILD

I want to understand the application rather than blindly copy generated code.

After completing each meaningful feature, explain:

1. What we built.
2. Why it is necessary.
3. How the architecture works.
4. Which files were created or changed.
5. What each important file does.
6. How the frontend communicates with the backend.
7. How the database is involved.
8. How authentication and permissions work in this feature.
9. What could go wrong.
10. How we tested it.
11. How I can test it manually.
12. What remains incomplete.
13. What the next logical step is.

Explain new technical concepts with small examples when useful.

Do not explain every obvious line of code individually unless I ask. Focus on helping me understand the structure, important logic, tradeoffs, and debugging process.

Provide exact commands I need to run, explain what they do, and tell me what output or behavior to expect.

If a command fails, diagnose the actual error rather than repeatedly suggesting random fixes.

Do not proceed on the assumption that I understood a critical security or architecture decision.

---

## 20. WORKSPACE AND FILE MANAGEMENT

Maintain an organized project.

Before editing files:

- Inspect the existing implementation.
- Identify dependencies.
- Understand how the target files are used.
- Check whether a reusable implementation already exists.

When editing:

- Make focused, logically grouped changes.
- Avoid unrelated modifications.
- Preserve working behavior.
- Avoid duplicate files and components.
- Follow naming conventions.
- Update tests and documentation alongside the code.
- Check imports and dependencies.
- Run formatting, linting, type checking, and relevant tests.

After each milestone, summarize the modified files and their purpose.

Never delete or replace substantial existing code without understanding it and explaining why the change is necessary.

Keep project notes and an implementation checklist so work can resume accurately across sessions.

---

## 21. PROJECT DOCUMENTATION

Maintain the following documents as appropriate:

- README.md — project setup and developer instructions.
- docs/architecture.md — system architecture.
- docs/roadmap.md — implementation roadmap.
- docs/domain-model.md — domain entities and relationships.
- docs/security.md — security design and outstanding risks.
- docs/permissions.md — role and permission matrix.
- docs/testing.md — test strategy and execution instructions.
- docs/design-system.md — design conventions and reusable components.
- docs/api.md — API conventions and endpoints.
- docs/decisions/ — significant architecture decision records.
- docs/modules/ — module specifications and completion status.
- docs/compliance.md — control mapping and compliance evidence status.
- docs/project-status.md — completed work, known issues, and next steps.

Adjust the exact structure to the chosen stack, but preserve the documentation's purpose.

Do not allow documentation to claim that unfinished features are complete.

---

## 22. COMMUNICATION AND APPROVAL RULES

Work collaboratively with me.

Before each major module, provide a short implementation plan and list the decisions that require my approval.

After each module, provide:

### A. What was built
Describe the user-facing features and backend functionality.

### B. Files created or modified
Explain the important files and their roles.

### C. Architecture
Explain how the new feature connects to the existing system.

### D. Security
Explain the relevant access controls, data protection, and validation.

### E. Testing
List the tests actually executed and their real results.

### F. Manual verification
Give me a step-by-step checklist for trying the feature myself.

### G. Outstanding issues
List known bugs, missing functionality, technical debt, and unresolved risks.

### H. Next step
Recommend the next module, but wait for my approval.

Do not silently skip tests.

Do not conceal failing tests.

Do not begin another major module before I have reviewed the current milestone.

If I request a correction, fix and retest the affected functionality before proceeding.

---

## 23. SPECIAL RULES FOR THE CEO / SUPER ADMIN EXPERIENCE

The CEO interface is our first major user-facing deliverable.

It must look and feel like a premium enterprise product from the first usable version.

The CEO should have a coherent view of the company's operations without navigating through dozens of disconnected pages.

Design a clear information hierarchy:

- Executive overview.
- Clients.
- Contracts and engagement letters.
- Projects and budgets.
- Tasks and resource allocation.
- Team and employee management.
- Timesheets.
- Leave.
- Attendance.
- Payroll.
- Invoicing and payments.
- Notifications.
- Reports and analytics.
- Audit logs.
- Company settings.
- Security and permissions.

Use navigation groups, collapsible sections, breadcrumbs, contextual actions, and a command palette where appropriate.

Every dashboard metric should link to relevant detailed records when permissions allow.

The CEO must be able to understand:

- What is happening across the company?
- Which projects are at risk?
- Which projects are exceeding their budgets?
- Which employees are overloaded or underutilized?
- Which tasks are overdue?
- How many hours remain in each project?
- Which clients have outstanding invoices?
- Which contracts are expiring?
- Which leave requests require approval?
- Which operational or financial issues require attention?

Avoid overcrowding the dashboard. Prioritize actionable information and let users drill down into detailed views.

Do not display sensitive payroll details unless the current user has the relevant permission.

---

## 24. FINAL ACCEPTANCE CRITERIA

The ERP should ultimately satisfy these requirements:

- A coherent and premium UI/UX across all modules.
- Consistent interactions and reusable design components.
- Secure authentication and appropriate MFA.
- Reliable tenant isolation.
- Server-enforced authorization.
- Clear separation of business and technical administration.
- Correct relationships between business records.
- Accurate project budget and hour allocation.
- Correct distinction between planned and actual hours.
- Reliable leave and attendance workflows.
- Verified payroll calculations for the selected jurisdiction.
- Reliable invoice and payment tracking.
- Centralized and secure notifications.
- Comprehensive module dashboards.
- Meaningful audit history.
- Automated unit, integration, security, and end-to-end tests.
- Organized code and documentation.
- Reproducible setup and deployment.
- A documented security and compliance assessment.
- An architecture ready for a future React Native client.

Production readiness must be demonstrated through evidence, not appearance or assumptions.

---

## 25. YOUR FIRST TASK — DO NOT START CODING THE ENTIRE ERP

Begin with Phase 0.

First, inspect my current workspace and determine what already exists.

Then provide:

1. **Project assessment:** What files, frameworks, dependencies, and functionality already exist?
2. **Recommended stack:** Your proposed technologies and the reasons for selecting them.
3. **System architecture:** Explain the major components and how they interact.
4. **Multi-tenant security model:** Explain how companies and their data will remain isolated.
5. **Initial database design:** Identify the essential foundation entities and their relationships.
6. **Role and permission architecture:** Explain how CEO, manager, team leader, employee, and technical administrator access will work.
7. **Design direction:** Propose a premium visual system and interaction style.
8. **Directory structure:** Show the planned file and module organization.
9. **Development roadmap:** Explain the order in which we will build and test the modules.
10. **Risks and important decisions:** Identify anything that must be decided before implementation.

Ask me only the essential questions needed to avoid expensive architectural mistakes. Group related questions together when useful, and suggest sensible defaults.

Do not ask me to decide every technical detail. I want you to make professional recommendations and explain them.

Do not create the complete application in one response.

After the discovery and planning phase, wait for my approval before beginning substantial implementation.

Once approved, build the foundation first, then the CEO/Super Admin interface, and continue module by module.

**The guiding principle for this project is: exceptional design, correct business logic, secure architecture, connected workflows, understandable code, and verified functionality.**

Let's build this as a real commercial ERP product, not a disposable prototype.