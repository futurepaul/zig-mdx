#!/usr/bin/env bun

/**
 * Example usage of zig-mdx parser
 */

import { parse } from "./src/index";

const mdxSource = `---
title: Hello World
---

# Hello MDX!

The answer is {40 + 2}.

This is **bold** and this is *italic*.

Here's a [link](https://example.com) and an image:

![Alt text](image.jpg)

## Code Examples

Inline \`code\` and a code block:

\`\`\`typescript
const greeting = "Hello, World!";
console.log(greeting);
\`\`\`

## Lists

- Item 1
- Item 2
  - Nested item

## JSX Components

<CustomComponent prop="value">
  This is **JSX** with MDX!
</CustomComponent>

## Expressions


> This is a blockquote
> with multiple lines

---

That's all folks!
`;

console.log("🔍 Parsing MDX...\n");

try {
  const ast = await parse(mdxSource);

  console.log("✅ Parse successful!\n");
  console.log(`📊 Stats:`);
  console.log(`   Nodes: ${ast.nodes.length}`);
  console.log(`   Tokens: ${ast.tokens.length}`);
  console.log(`   Errors: ${ast.errors.length}`);

  if (ast.errors.length > 0) {
    console.log("\n⚠️  Errors:");
    for (const error of ast.errors) {
      console.log(`   - ${error.tag} at token ${error.token}`);
    }
  }

  console.log("\n🌳 AST Nodes:");
  for (const node of ast.nodes.slice(0, 10)) {
    console.log(`   [${node.index}] ${node.type}`);
    if ("text" in node && node.text) {
      const text = node.text.length > 40 ? node.text.slice(0, 40) + "..." : node.text;
      console.log(`       "${text}"`);
    }
    if ("level" in node) {
      console.log(`       level: ${node.level}`);
    }
    if ("name" in node && node.name) {
      console.log(`       name: ${node.name}`);
    }
  }

  if (ast.nodes.length > 10) {
    console.log(`   ... and ${ast.nodes.length - 10} more nodes`);
  }

  console.log("\n🎉 Done!");
} catch (error) {
  console.error("❌ Error:", error);
  process.exit(1);
}
