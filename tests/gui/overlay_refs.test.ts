import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * v2.8.5: Fixed the GUI going blank when hovering "Add stream" or "Add IMIX".
 *
 * OverlayTrigger attaches refs to its overlay (the fade transition node) and to
 * its child (the popper anchor and hover target). React 19.3 gives fragments
 * refs as FragmentInstance objects, which are not DOM nodes: a fragment overlay
 * crashes the transition and unmounts the whole app, and a fragment child
 * silently drops the hover handlers. Every OverlayTrigger must therefore use a
 * real element for both.
 */

const srcRoot = resolve(__dirname, "../../Configuration GUI/src");

const sourceFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return entry.name.endsWith(".tsx") ? [path] : [];
    });

// Index just past the ">" that closes the JSX opening tag starting at `start`,
// skipping braces and string literals inside attribute expressions.
const openingTagEnd = (source: string, start: number): number => {
    let depth = 0;
    let quote: string | null = null;
    for (let i = start; i < source.length; i++) {
        const c = source[i];
        if (quote) {
            if (c === quote) quote = null;
        } else if (c === "\"" || c === "'" || c === "`") {
            quote = c;
        } else if (c === "{") {
            depth++;
        } else if (c === "}") {
            depth--;
        } else if (c === ">" && depth === 0) {
            return i + 1;
        }
    }
    throw new Error(`Unterminated JSX tag at offset ${start}`);
};

const attributeExpression = (tag: string, name: string): string | null => {
    const match = new RegExp(`\\b${name}=\\{`).exec(tag);
    if (!match) return null;
    let depth = 1;
    let i = match.index + match[0].length;
    for (; i < tag.length && depth > 0; i++) {
        if (tag[i] === "{") depth++;
        if (tag[i] === "}") depth--;
    }
    return tag.slice(match.index + match[0].length, i - 1);
};

interface Trigger {
    location: string;
    overlay: string | null;
    child: string;
}

const triggers: Trigger[] = sourceFiles(srcRoot).flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return [...source.matchAll(/<OverlayTrigger\b/g)].map((match) => {
        const end = openingTagEnd(source, match.index!);
        const tag = source.slice(match.index!, end);
        // First child after the opening tag, ignoring whitespace and JSX comments.
        const child = source
            .slice(end)
            .replace(/^(\s|\{\/\*[\s\S]*?\*\/\})*/, "")
            .slice(0, 80);
        const line = source.slice(0, match.index).split("\n").length;
        return { location: `${relative(srcRoot, file)}:${line}`, overlay: attributeExpression(tag, "overlay"), child };
    });
});

describe("OverlayTrigger refs", () => {
    test("the source scan finds the GUI's tooltips", () => {
        expect(triggers.length).toBeGreaterThan(20);
    });

    test("no overlay is a fragment", () => {
        const offenders = triggers
            .filter(({ overlay }) => overlay !== null && /<>|<\/>|<React\.Fragment|<Fragment/.test(overlay))
            .map(({ location, overlay }) => `${location}: overlay={${overlay}}`);
        expect(offenders).toEqual([]);
    });

    test("no trigger child is a fragment", () => {
        const offenders = triggers
            .filter(({ child }) => /^(<>|<React\.Fragment|<Fragment)/.test(child))
            .map(({ location, child }) => `${location}: child ${child.split("\n")[0]}`);
        expect(offenders).toEqual([]);
    });
});
