---
description: Security-focused code review for OWASP vulnerabilities
---

Perform a security review of: $ARGUMENTS

## Check for OWASP Top 10 Issues

### Injection
- SQL injection: Are queries parameterized? No string concatenation?
- Command injection: Are shell commands using untrusted input?
- LDAP/XPath injection: Any directory or XML queries?

### Broken Authentication
- Are credentials stored securely (hashed, not plaintext)?
- Session management flaws?
- Weak password policies?

### Sensitive Data Exposure
- Is sensitive data logged accidentally?
- Are secrets hardcoded (API keys, passwords, URLs)?
- Is PII handled appropriately?

### Broken Access Control
- Are authorization checks in place?
- Can users access resources they shouldn't?
- Are IDs predictable/enumerable?

### Security Misconfiguration
- Debug mode enabled in production?
- Default credentials?
- Unnecessary features exposed?

### XSS (if applicable)
- Is user input sanitized before output?
- Are Content-Type headers correct?

### Insecure Deserialization
- Is untrusted data being deserialized?
- Are there type confusion risks?

### Vulnerable Dependencies
- Are there known CVEs in dependencies?
- Are dependencies up to date?

## Output
- List any security issues found with severity (Critical/High/Medium/Low)
- Provide specific file:line references
- Suggest fixes for each issue
