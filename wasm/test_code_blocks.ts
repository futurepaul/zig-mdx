#!/usr/bin/env bun

/**
 * Test code block support in zig-mdx WASM
 */

import { parse } from "./src/index";

const mdxSource = `# Code Blocks Test

Here's some TypeScript:

\`\`\`typescript
const greeting = "Hello, World!";
console.log(greeting);
\`\`\`

And some JavaScript:

\`\`\`javascript
function add(a, b) {
  return a + b;
}
\`\`\`

Code without language:

\`\`\`
plain code block
no syntax highlighting
\`\`\`

Some text after the code blocks.
`;

console.log("🔍 Testing Code Block Support...\n");

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

  // Find code block nodes
  const codeBlocks = ast.nodes.filter((n) => n.type === "code_block");

  console.log(`\n✅ Found ${codeBlocks.length} code block(s)`);

  for (const block of codeBlocks) {
    console.log(`\n📦 Code Block [${block.index}]:`);
    console.log(`   Main token: ${block.mainToken}`);

    // The token after code_fence_start should be the language
    const langToken = ast.tokens[block.mainToken + 1];
    if (langToken && langToken.tag === "text") {
      const lang = ast.source.substring(langToken.start, langToken.end);
      console.log(`   Language: "${lang}"`);
    }

    // Check for children or data
    if ("children" in block) {
      console.log(`   Children: ${JSON.stringify(block.children)}`);
    }
    if ("data" in block && typeof block.data === "object") {
      console.log(`   Data: ${JSON.stringify(block.data)}`);
    }
  }

  // Check document children
  const document = ast.nodes[ast.nodes.length - 1];
  if (document && "children" in document) {
    const children = document.children;
    console.log(`\n✅ Document has ${children.length} children`);

    // Count types of children
    const childTypes: Record<string, number> = {};
    for (const childIdx of children) {
      if (typeof childIdx === "number") {
        const child = ast.nodes[childIdx];
        const type = child.type;
        childTypes[type] = (childTypes[type] || 0) + 1;
      }
    }
    console.log(`   Child types: ${JSON.stringify(childTypes)}`);
  }

  console.log("\n🎉 Code blocks are working!");
} catch (error) {
  console.error("❌ Error:", error);
  process.exit(1);
}
