import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Diagram } from "./diagram";
import { config } from "../config";

// http://plantuml.com/en/preprocessing
const INCLUDE_REG = /^\s*!(include(?:sub)?)\s+(.+?)(?:!(\w+))?$/i;


export function getIncludes(diagram: Diagram): string[] {
    // console.log('Start from:', _route[0]);
    let searchPaths = getSearchPaths(diagram.parentUri);
    let foundIncludeds:string[] = [];
    findIncludes(diagram.lines, searchPaths, foundIncludeds);
    return foundIncludeds;
}

function findIncludes(content: string | string[], searchPaths: string[], foundIncludeds: string[]): void {
    let lines = content instanceof Array ? content : content.split('\n');

    lines.filter((line: string) => (line.match(INCLUDE_REG) != null)).forEach(
        (line: string) => line.replace( //TODO: Fix to don't abuse replace
            INCLUDE_REG,
            (match: string, ...args: string[]) => { 
                let Action = args[0].toLowerCase();
                let target = args[1].trim();
                let sub = args[2];
                let file = path.isAbsolute(target) ? target : findFile(target, searchPaths);
                if (foundIncludeds.indexOf(file) == -1)  {
                    foundIncludeds.push(file)
                    findIncludesInIncluded(file, foundIncludeds);
                }
                return "";
            }
        )
    );
}

function getSearchPaths(uri: vscode.Uri): string[] {
    if (!uri) return [];
    let searchPaths = [path.dirname(uri.fsPath)];
    searchPaths.push(...config.includepaths(uri));
    let diagramsRoot = config.diagramsRoot(uri);
    if (diagramsRoot)
        searchPaths.push(diagramsRoot.fsPath);
    return Array.from(new Set(searchPaths));
}

function findFile(file: string, searchPaths: string[]): string {
    let found: string;
    for (let dir of searchPaths) {
        found = path.join(dir, file);
        if (fs.existsSync(found))
            return found
    }
    return undefined;
}

function findIncludesInIncluded(file: string, foundIncludeds: string[]): void {
    if (!file) return

    let content = fs.readFileSync(file).toString();
    let result = findIncludes(content, getSearchPaths(vscode.Uri.file(file)), foundIncludeds);
}