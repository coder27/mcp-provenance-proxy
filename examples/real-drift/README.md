# Example: real drift, from a real package's real version history

Every other example in this repo uses either the in-repo test fixture or a single pinned version of a real server. This one is different: it runs the proxy against **two different, real, npm-published versions of the same server** — [`@modelcontextprotocol/server-filesystem`](https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem) `2025.7.1` (July 2025) and `2026.8.31` (today, at time of writing) — to show drift detection catching something that actually happened, not a contrived toolset swap.

**Nothing here is malicious.** This is a real, actively-maintained open-source project evolving normally over about 14 months. That's the point: drift detection doesn't judge intent or decide what's dangerous — it makes every change to a tool's contract visible, at the moment it's first observed, so a human (or a policy layer built on top of this data) can decide whether it matters. A rug pull and an honest refactor produce the identical kind of record; only the human reading it can tell them apart.

## Reproduce it

```bash
cd examples/real-drift
node drive-toolslist.mjs ./session1.config.json   # talks to server-filesystem@2025.7.1
node drive-toolslist.mjs ./session2.config.json   # talks to server-filesystem@2026.8.31
node ../../dist/cli.js drift
```

Both configs point at the same `./.mcp-provenance` storage directory, so the second run's `tools/list` is compared against the baseline the first run seeded.

npm package versions can in principle be unpublished; if `2025.7.1` no longer resolves, `npm view @modelcontextprotocol/server-filesystem versions` will show what's still available; the shape of the result below won't change even if you have to substitute an earlier or later pair.

## The headline finding

`read_file` is the clearest single example — a full, real `DRIFT` record pair from an actual run:

```
[mtsbrs0t-c57bdb37] #6 HIGH description-changed tool=read_file
  old="Read the complete contents of a file from the file system. Handles various text
       encodings and provides detailed error messages if the file cannot be read. Use this
       tool when you need to examine the contents of a single file. Use the 'head' parameter
       to read only the first N lines of a file, or the 'tail' parameter to read only the
       last N lines of a file. Only works within allowed directories."
  new="Read the complete contents of a file as text. DEPRECATED: Use read_text_file instead."

[mtsbrs0t-c57bdb37] #7 HIGH schema-changed tool=read_file
  schemaDiff=[
    {"path":"type","change":"added","newValue":"object"},
    {"path":"properties","change":"added","newValue":{"path":{"type":"string"},
      "tail":{"description":"...","type":"number"},"head":{"description":"...","type":"number"}}},
    {"path":"required","change":"added","newValue":["path"]}
  ]

[mtsbrs0t-c57bdb37] #8 LOW new-tool tool=read_text_file
[mtsbrs0t-c57bdb37] #9 LOW new-tool tool=read_media_file
```

Between these two versions, the maintainers split `read_file` into three tools (`read_text_file` and `read_media_file` for the new, more specific cases; `read_file` kept around, now explicitly marked deprecated in its own description) — a real, sensible API evolution. It's also exactly the *shape* of change that matters when it isn't sensible: a tool's name staying the same while its description and parameters change underneath an agent that already trusts it.

## The rest of the diff (full real output, unedited)

The 2025.7.1 release had a real bug of its own worth noting honestly: nearly every tool's `inputSchema` was serialized as just `{"$schema": "..."}"` with no `properties` at all. That bug was fixed at some point before `2026.8.31`, so **most of the `schema-changed` events below are that bug being fixed, not new capability being added** — legitimate drift by this tool's definition (the schema genuinely changed), but not a security story on their own. This is why severity and a human in the loop both matter: the tool reports precisely what changed and lets you judge it, rather than deciding for you.

Full output from the actual run above:

```
[mtsbrs0t-c57bdb37] #6 HIGH description-changed tool=read_file ...
[mtsbrs0t-c57bdb37] #7 HIGH schema-changed tool=read_file ...
[mtsbrs0t-c57bdb37] #8 LOW new-tool tool=read_text_file
[mtsbrs0t-c57bdb37] #9 LOW new-tool tool=read_media_file
[mtsbrs0t-c57bdb37] #10 HIGH schema-changed tool=read_multiple_files ...
[mtsbrs0t-c57bdb37] #11 HIGH schema-changed tool=write_file ...
[mtsbrs0t-c57bdb37] #12 HIGH schema-changed tool=edit_file ...
[mtsbrs0t-c57bdb37] #13 HIGH schema-changed tool=create_directory ...
[mtsbrs0t-c57bdb37] #14 HIGH schema-changed tool=list_directory ...
[mtsbrs0t-c57bdb37] #15 HIGH schema-changed tool=list_directory_with_sizes ...
[mtsbrs0t-c57bdb37] #16 HIGH schema-changed tool=directory_tree ...
[mtsbrs0t-c57bdb37] #17 HIGH schema-changed tool=move_file ...
[mtsbrs0t-c57bdb37] #18 HIGH description-changed tool=search_files
  old="...The search is case-insensitive and matches partial names..."
  new="...The patterns should be glob-style patterns that match paths relative to the
       working directory. Use pattern like '*.ext' to match files in current directory,
       and '**/*.ext' to match files in all subdirectories..."
[mtsbrs0t-c57bdb37] #19 HIGH schema-changed tool=search_files ...
[mtsbrs0t-c57bdb37] #20 HIGH schema-changed tool=get_file_info ...
[mtsbrs0t-c57bdb37] #21 HIGH description-changed tool=list_allowed_directories
  old="...Use this to understand which directories are available before trying to access files."
  new="...Subdirectories within these allowed directories are also accessible. Use this to
       understand which directories and their nested paths are available..."
[mtsbrs0t-c57bdb37] #22 HIGH schema-changed tool=list_allowed_directories ...
```

(`...` above elides repeated schema JSON for readability in this table; `node ../../dist/cli.js drift` prints every field in full.) `search_files`'s description change is a genuine, meaningful one worth reading closely: the pattern-matching semantics themselves changed (substring match → glob match), which would silently break any agent's existing assumptions about what a given `pattern` argument matches, even though nothing "failed."

Note the session ID (`mtsbrs0t-c57bdb37`) and sequence numbers above are from one specific real run and will differ on yours — the diff content will not.
