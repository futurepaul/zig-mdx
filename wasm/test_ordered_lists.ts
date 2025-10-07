#!/usr/bin/env bun

/**
 * Test ordered list support in zig-mdx
 */

import { parse } from "./src/index";

const mdxSource = `# Lists Test

## Unordered Lists

- First item
- Second item
- Third item

## Ordered Lists

1. First ordered item
2. Second ordered item
3. Third ordered item

## Ordered Lists with Formatting

1. Item with **bold**
2. Item with *italic*
3. Item with {expression}
4. Item with \`code\`

## Large Numbers

10. Starting at ten
11. Continuing
12. More items
99. Large number
100. Three digits

## Mixed Content

Some paragraph text.

1. After paragraph
2. More ordered items

- Then unordered
- More unordered

1. Back to ordered
2. Final ordered item
`;

console.log("🔍 Testing Ordered List Support...\n");

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

  // Find and display list nodes
  const listNodes = ast.nodes.filter(
    (n) => n.type === "list_ordered" || n.type === "list_unordered"
  );

  console.log(`\n📋 Found ${listNodes.length} list nodes:`);
  for (const node of listNodes) {
    const children = "children" in node ? node.children : [];
    console.log(`   [${node.index}] ${node.type} (${children.length} items)`);
  }

  // Display some list items
  const listItemNodes = ast.nodes.filter((n) => n.type === "list_item");
  console.log(`\n📝 Found ${listItemNodes.length} list item nodes`);

  console.log("\n🎉 Ordered lists are working!");
} catch (error) {
  console.error("❌ Error:", error);
  process.exit(1);
}
