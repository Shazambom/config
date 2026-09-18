# Rust documents

Read [design.rs.txt](design.rs.txt) and [support.rs.txt](support.rs.txt) in full. They cover the same order-placement flow, receipt derivation, unchanged store contract, and unresolved duplicate-key policy as the Go example.

Use `design.rs`, optional `support.rs`, and this dependency-free `Cargo.toml`:

```toml
[package]
name = "design-session"
version = "0.0.0"
edition = "2021"

[lib]
path = "design.rs"

[workspace]
```

The empty workspace prevents membership in an enclosing application workspace. Never modify the application's Cargo files. Keep build outputs in this ignored design directory. Snapshot every authored file, including the manifest and any retained lockfile, with a `.txt` suffix; never snapshot `target/`.

Start with `/* ... */` containing spacious Rust pseudocode. Declare `mod support;` and import the needed support types below the flow. Contracts use structs, enums, aliases, function pointer types, or actual trait contracts. Function pointer aliases represent proposed signatures; they do not require function-pointer implementations. Label the real receiver for a concrete method rather than inventing a trait. Trait methods have signatures ending in `;`, never default bodies. No function bodies, `todo!`, `unimplemented!`, panic placeholders, impl blocks, or executable initializers.

The examples are a Rust document model of Go source, not Rust implementation requirements. `Option<Vec<T>>` retains nil-versus-empty slices. An explicit result/error tuple retains the source error channel rather than claiming the stronger relationship of a native `Result`. Nominal identifier structs preserve distinct names. Opaque context and error types are tooling stand-ins, not implementations. Value parameters and owned-looking Rust types here assert no source ownership transfer, cloning, lifetime, borrowing, thread-safety, or cancellation guarantees. Inspect those semantics separately and label unresolved gaps. When designing a native Rust project, preserve its real references, lifetimes, error conventions, and trait bounds instead of copying this model.

Format with `RUSTUP_AUTO_INSTALL=0 rustfmt --edition 2021 design.rs support.rs`, omitting support if absent. From the isolated directory run `RUSTUP_AUTO_INSTALL=0 CARGO_NET_OFFLINE=true cargo check --offline --lib --target-dir "$PWD/target"`. Verify that target path stays inside the ignored workspace before running the check. The explicit target overrides inherited Cargo output settings. Cargo's offline flag does not disable rustup downloads; keep automatic toolchain installation disabled and report an unavailable ancestor toolchain pin as unverified. No dependencies or toolchains may be fetched.

If an installed rustup tool is absent from PATH, resolve it under `$HOME/.cargo/bin`; do not treat a PATH miss as proof it is uninstalled. Use rust-analyzer diagnostics if available, but do not install or configure editor tools during design. Editors may maintain their own caches. Report missing cargo, rustfmt, or rust-analyzer as unverified checks, not passes. Compilation checks declarations only, not the pseudocode or source-language equivalence.
