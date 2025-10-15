/**
 * Type definitions for zig-mdx WASM exports and AST
 */

export interface WasmExports {
  memory: WebAssembly.Memory;
  wasm_init(): void;
  wasm_get_version(): number;
  wasm_alloc(size: number): number;
  wasm_free(ptr: number, size: number): void;
  wasm_parse_mdx(
    sourcePtr: number,
    sourceLen: number,
    outJsonPtr: number,
    outJsonLen: number
  ): boolean;
  wasm_reset(): void;
}

export interface ParseError {
  tag: string;
  token: number;
}

export interface BaseNode {
  type: string;
}

export interface RootNode extends BaseNode {
  type: "root";
  children: Node[];
}

export interface ParagraphNode extends BaseNode {
  type: "paragraph";
  children: Node[];
}

export interface HeadingNode extends BaseNode {
  type: "heading";
  level: number;
  children: Node[];
}

export interface TextNode extends BaseNode {
  type: "text";
  value: string;
}

export interface LinkNode extends BaseNode {
  type: "link";
  url: string;
  children: Node[];
}

export interface ImageNode extends BaseNode {
  type: "image";
  url: string;
  children: Node[];
}

export interface CodeBlockNode extends BaseNode {
  type: "code_block";
  lang?: string;
  value: string;
}

export interface InlineCodeNode extends BaseNode {
  type: "code_inline";
  value: string;
}

export interface BlockquoteNode extends BaseNode {
  type: "blockquote";
  children: Node[];
}

export interface ListNode extends BaseNode {
  type: "list_unordered" | "list_ordered";
  children: Node[];
}

export interface ListItemNode extends BaseNode {
  type: "list_item";
  children: Node[];
}

export interface JsxAttribute {
  name: string;
  type: "literal" | "expression";
  value?: string;
}

export interface JsxElementNode extends BaseNode {
  type: "mdx_jsx_element";
  name: string;
  attributes: JsxAttribute[];
  children: Node[];
}

export interface JsxSelfClosingNode extends BaseNode {
  type: "mdx_jsx_self_closing";
  name: string;
  attributes: JsxAttribute[];
}

export interface JsxFragmentNode extends BaseNode {
  type: "mdx_jsx_fragment";
  children: Node[];
}

export interface MdxTextExpressionNode extends BaseNode {
  type: "mdx_text_expression";
  value: string;
}

export interface MdxFlowExpressionNode extends BaseNode {
  type: "mdx_flow_expression";
  value: string;
}

export interface EmphasisNode extends BaseNode {
  type: "emphasis";
  children: Node[];
}

export interface StrongNode extends BaseNode {
  type: "strong";
  children: Node[];
}

export interface ThematicBreakNode extends BaseNode {
  type: "hr";
}

export interface FrontmatterNode extends BaseNode {
  type: "frontmatter";
  value: string;
}

export type Node =
  | RootNode
  | ParagraphNode
  | HeadingNode
  | TextNode
  | LinkNode
  | ImageNode
  | CodeBlockNode
  | InlineCodeNode
  | BlockquoteNode
  | ListNode
  | ListItemNode
  | JsxElementNode
  | JsxSelfClosingNode
  | JsxFragmentNode
  | MdxTextExpressionNode
  | MdxFlowExpressionNode
  | EmphasisNode
  | StrongNode
  | ThematicBreakNode
  | FrontmatterNode;

export interface AST extends RootNode {
  source: string;
  errors: ParseError[];
}
