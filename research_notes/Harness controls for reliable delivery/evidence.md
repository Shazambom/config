# Harness controls for reliable delivery

## How can acceptance evidence remain independent of agent-written fixtures?

### Takeaway
Use an externally owned acceptance contract and verifier, not another reviewing agent. Agent-written tests remain useful development evidence, but cannot by themselves authorize a delivery claim.

Research scope: one bounded public-source pass; four primary sources fetched successfully. All controls below are proposals, not claims about this repository's implementation. No local runtime or deployment was inspected.

### Cited Findings
- Anthropic distinguishes the transcript from the outcome: an agent saying a flight is booked is different from a reservation existing in the environment's database. It recommends stable isolated trials, reference solutions, deterministic graders where possible, and graders resistant to bypasses. It explicitly warns that shared files, caches and even previous-trial git history can inflate scores. [Anthropic, “Demystifying evals for AI agents,” sections “The structure of an evaluation” and steps 2–5](https://www.anthropic.com/research/demystifying-evals-for-ai-agents)
- Harbor documents separate task instructions, environment definitions, verification scripts and optional reference solutions. Its documented lifecycle runs the agent, then calls a verifier; utility agents include an oracle and a no-op agent. This is an existing framework pattern for separate task execution and verification, not proof of a security boundary. [Harbor repository, “Key Concepts” and “Key Patterns”](https://github.com/harbor-framework/harbor/blob/main/AGENTS.md)
- OpenAI reports that SWE-bench hides its evaluation tests from the model, yet correct solutions can still fail because tests require unspecified function names or extra functionality. Its audit found material problems in 59.4% of 138 selected difficult tasks, not 59.4% of the entire 500-task Verified set. The selected tasks were ones o3 did not consistently solve across 64 runs. Independence alone does not make an oracle correct. [OpenAI, “Why we no longer evaluate SWE-bench Verified,” “Background” and “Too narrow and too wide tests”](https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/)

### Inferences
These are proposed engineering controls, inferred from the findings rather than capabilities claimed by the sources.

#### 1. Freeze a small acceptance contract before implementation
- Smallest mechanism: one owner-approved contract containing the user input, observable outcome, forbidden outcome, supported environment and acceptable timeout. Store its digest and verifier version outside the agent's writable workspace. The runner supplies a clean verifier after implementation. Separate development tests from acceptance checks in the result.
- Ownership: the person responsible for the requirement approves semantics. A trusted runner controls execution and result recording. No extra agent fleet is needed. The agent may propose tests but cannot silently change the authoritative contract.
- Acceptance test: use a known-good implementation, a broken implementation and a no-op implementation. The good one passes; the other two fail. Attempting to edit the contract or verifier invalidates the run. An alternate correct implementation also passes, without needing private function names.
- Cost: one contract and one reference case per behavior, plus maintaining a separate execution boundary. Keep the first contract to one user-visible behavior.
- Gaming risk: an agent can overfit a visible example; a hidden test can encode unstated requirements. Randomize example values, not requirements, and keep the semantic contract visible. If the agent has administrator access to the verifier or its result store, file separation is not protection.
- Status: proposed here. Harbor supplies documented task/verifier concepts; the fetched material does not establish that its verifier is inaccessible to a malicious agent.

#### 2. Record test provenance and prove that the check can fail
- Smallest mechanism: attach a runner-created manifest to each acceptance result: contract digest, implementation digest, verifier digest, fixture origin, environment fingerprint, exact command, start/end times and raw evidence paths. Classify fixtures as synthetic, captured or live. A generated fixture cannot be relabeled as a live observation.
- Add two targeted fault injections to the acceptance check, not a general mutation-testing platform: disable the behavior and corrupt the expected observation. Run these in a disposable test environment.
- Acceptance test: a constant-success stub and a fixture containing only the expected answer must fail the live acceptance check. Disable result delivery and verify failure. Restore delivery but corrupt the decoder and verify an observation-error result rather than a product-failure verdict. Missing provenance yields unverified, never pass.
- Cost: manifest generation and two additional bounded test executions. Digests establish which bytes ran; they do not establish that those bytes express the correct requirement.
- Gaming risk: detecting the test environment and returning canned results. Use fresh challenge values through the normal interface and a verifier the candidate cannot modify. A few mutations test known blind spots, not complete correctness.
- Status: proposed. The sources support isolated trials and calibrated graders, but do not document this exact manifest or mutation protocol.

### Gaps
- No source here establishes that agent-written tests are inherently unreliable. The narrower concern is circular evidence when the same implementation assumptions determine the fixture and expected result.
- No empirical effect size was found for these proposed controls. Costs above are qualitative design estimates, not measurements.
- Public benchmark contamination and a local circular fixture are different problems. OpenAI's analysis supports caution about exposed solutions and flawed tests, not a claim that every local fixture is contaminated.

## How can the runner distinguish product failures from observation failures?

### Takeaway
Validate the observation path separately from the product path. Match evidence using native identifiers and fresh run tokens; treat names, saved summaries and rendered views as projections that need their own checks.

### Cited Findings
- Anthropic describes tasks failing because tests assume an unspecified filepath and recommends a known-working reference solution to verify grader configuration. It recommends reading transcripts to distinguish genuine agent mistakes from graders rejecting valid solutions. Its advice favors outcomes over rigid tool-call sequences. [Anthropic, steps 2, 5 and 6](https://www.anthropic.com/research/demystifying-evals-for-ai-agents)
- OpenAI documents a task whose tests import `get_annotation`, a function name absent from the problem description. Correct implementations can therefore fail at import. It also describes platform and interpreter differences causing spurious failures. These are specific examples of an observation contract or environment being wrong rather than the requested behavior being absent. [OpenAI, “Background” and “Too narrow and too wide tests”](https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/)
- Harbor's contributor guidance prefers command behavior, parser wiring, callback effects or JSON payloads over console-help rendering, because presentation changes with terminal width, colors and platform. This supports structured observation over incidental rendering, not ignoring UI requirements when UI behavior is the actual task. [Harbor, “Testing”](https://github.com/harbor-framework/harbor/blob/main/AGENTS.md)

### Inferences
#### 3. Add one observation-conformance check
- Smallest mechanism: retain a bounded raw event record and test the decoder/projector against a tiny independently specified sequence. Use native entity ID, run ID, sequence or cursor, event kind and timestamp. Store display name separately. Define exactly which source is authoritative for each assertion.
- For a live-delivery requirement, require a live subscriber to observe a fresh challenge within the deadline. A later saved transcript proves persistence, not that the subscriber received the event at the required time. Conversely, a transient live event does not prove persistence. Check both only if both are required.
- Acceptance test: two entities share a display name but have different native IDs; each result must remain attached to the correct entity. Rename one without changing its native ID. Inject duplicate and out-of-order events, then replay a stale saved projection while the live channel is disconnected. The check must not count the replay as fresh live delivery. Define duplicate handling in the contract rather than assuming every transport guarantees exactly-once delivery.
- Error classification: raw authoritative event present but absent from the projection means observation failure. No event plus a healthy, independently checked observer supports a product-path failure. A broken or untested observer means inconclusive, not an automatic product acquittal or conviction.
- Cost: small parser fixtures, raw-event retention and one live connection. Retain only needed fields and redact sensitive payloads.
- Gaming risk: both projections may share the same broken parser, so comparing them is not independent. Use a simple raw-level assertion with independently stated expected fields. A native ID is an identity key, not proof that an event is authentic; the runner must obtain it from the actual host API.
- Status: proposed. Native-ID and live-versus-saved checks are design deductions, not a feature attributed to Anthropic, OpenAI or Harbor.

#### Agent responsibility versus enforceable controls
An agent can make the conceptual mistakes of using display labels as identity, reading stale output or changing production code to satisfy a malformed fixture. A runner can enforce required identity fields, fresh challenge correlation, protected verifier digests and explicit evidence classes. It cannot infer the intended user behavior from a vague requirement. When evidence disagrees, preserve it and report inconclusive rather than launching more reviewers or allowing the agent to rewrite the acceptance rule.

### Gaps
- This pass did not inspect an actual event API, identity model or persistence format. The proposal must use the real host's identifiers and ordering guarantees, not invent fields the runtime cannot supply.
- A reference implementation passing does not prove that a grader rejects every bad implementation. The fault injections above cover specified failure modes only.

## What evidence should authorize a deployment or readiness claim?

### Takeaway
Keep command completion, artifact installation, process liveness and feature readiness as separate facts. A feature-ready claim should require a fresh end-to-end canary against the installed artifact through the real entry point.

### Cited Findings
- Kubernetes distinguishes startup, liveness and readiness. Readiness controls whether a container should receive traffic and can check required backend availability; liveness determines whether to restart it. Incorrect liveness checks can cause cascading failures. [Kubernetes, “Types of probe” and “When to use each probe”](https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/)
- Kubernetes documents that an exec probe succeeds on exit code zero, a TCP probe succeeds when a port opens, and an HTTP probe uses response status. These mechanisms test the condition the author encoded, not arbitrary feature correctness. Its probe result vocabulary includes `Unknown`. [Kubernetes, “Check mechanisms” and “Probe results”](https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/)
- Anthropic recommends evaluating an agent in an environment roughly matching production and combining offline evaluations with production monitoring. Backend state checks distinguish an actual operation from a confirmation page. [Anthropic, “Computer use agents,” step 4 and “How evals fit with other methods”](https://www.anthropic.com/research/demystifying-evals-for-ai-agents)

### Inferences
#### 4. Run one real-system canary
- Smallest mechanism: after deployment, submit one harmless request with a fresh nonce through the same installed entry point a user uses. Verify its outcome through the authoritative system and, if required, its delivery through the user-facing channel. Record the artifact identity that the running process actually loaded.
- Acceptance test: keep the source tree correct while deliberately deploying an older artifact in a disposable environment. The canary must reject the version mismatch. Break the real transport while a stub still passes; the canary must fail. Replay a prior successful response; its nonce must not satisfy the new request. Restore the real route and confirm success.
- Cost: one launch or request, a bounded wait and cleanup. External provider calls may cost money; use a scoped test account and never create irreversible customer effects.
- Gaming risk: a special canary-only code path or dependency bypass can pass while normal usage fails. Use the ordinary route and vary safe inputs. One canary proves that scenario at that time, not all features or future availability.
- Status: proposed; no real-system canary was run during this research.

#### 5. Emit a structured deployment receipt
- Smallest mechanism: the trusted runner writes one receipt with run ID, intended artifact digest, observed installed/loaded artifact identity, destination identity, command exit status, process identity and liveness observation, canary contract/version, nonce, assertion outcomes, timestamps, evidence references and cleanup result. Exclude credentials and customer payloads.
- Use independent fields rather than a single optimistic status: `command_completed`, `artifact_verified`, `process_live`, `feature_check`. Each observation is pass, fail, unknown or not-run with a reason. Preserve an overall verdict computed from the contract's required checks. A command exiting zero can coexist with `feature_check: fail`.
- Acceptance test: installer exits zero but the process never starts; receipt cannot say feature-ready. Process starts but the feature fails; liveness may pass while readiness fails. Canary times out or the observer breaks; feature readiness is unknown or failed according to the explicit timeout contract. Reuse a receipt from another artifact or run; the gate rejects it. Successful fresh deployment records evidence for every required field.
- Cost: a small schema and gate around the existing deployment path, plus the canary above. Do not introduce a new service or database merely to store the receipt.
- Gaming risk: agent-authored receipts or editable evidence paths recreate self-certification. Runner-owned storage and digest binding reduce substitution; a digest cannot make a dishonest observation true. Readiness expires when the process or artifact changes and should be described as “verified at time T,” not a permanent property.
- Status: proposed. Kubernetes supplies an implemented separation of health concepts, not this deployment receipt schema.

### Gaps
- Local implementation and deployment status remain unverified. This assignment changed only this evidence document, with no code, configuration or runtime edits and no product tests.
- Successful fetches cover Anthropic's engineering guidance, OpenAI's primary audit, Harbor's official repository guidance and Kubernetes' official probe documentation. Harbor's task-format page returned incomplete content, and an attempted raw task-format documentation URL returned 404; neither was used as evidence. Harbor's fetched `main` documentation is mutable and was not pinned to a commit.
- No source promises that these mechanisms eliminate fixture gaming. The defensible initial target is narrower: the five injected failure cases must stop producing an unsupported success claim, while a known-good normal path still passes.
