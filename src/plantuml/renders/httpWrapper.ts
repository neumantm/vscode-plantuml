import * as http from 'http';
import * as https from 'https';
import * as url from 'url';
import * as fs from 'fs';
import * as JSON from 'JSON';
import * as jszip from 'jszip';

import { makePlantumlURL } from '../plantumlURL';
import { Diagram, diagramStartReg } from '../diagram/diagram';
import { RenderError } from './interfaces';
import { Dictionary } from 'linq-collections';
import { getIncludes } from '../diagram/include';

export const ERROR_405 = new Error("HTTP method POST is not supported by this URL");

export function httpWrapper(method: string, server: string, diagram: Diagram, format: string, index: number, savePath?: string): Promise<Buffer> {
    let requestPath: string, requestUrl: string;
    
    switch (method) {
        case "GET":
            requestUrl = makePlantumlURL(server, diagram, format, index);
            break;
        case "POST":
            // "om80" is used to bypass the pagination bug of the POST method.
            // https://github.com/plantuml/plantuml-server/pull/74#issuecomment-551061156
            requestUrl = [server, format, index, "om80"].join("/");
            break;
        default:
            return Promise.reject("Unsupported request method: " + method);
    }

    requestPath = [server, "json"].join("/");
    requestUrl = requestPath;
    method = "POST";

    return new Promise<Buffer>((resolve, reject) => {
        let buffBody: Buffer[] = [];
        let buffBodyLen = 0;
        let response: http.IncomingMessage;
        let httpError: any;

        let u = url.parse(requestUrl);
        let options = <https.RequestOptions>{
            protocol: u.protocol,
            auth: u.auth,
            host: u.host,
            hostname: u.hostname,
            port: parseInt(u.port),
            path: u.path,
            method: method,
            headers: {
                "Content-Type": 'application/json',
            },
        };

        let responseCallback = (res: http.IncomingMessage) => {
            // console.log('STATUS: ' + res.statusCode);
            // console.log('HEADERS: ' + JSON.stringify(res.headers));
            response = res
            // res.setEncoding('utf8');
            res.on('data', function (chunk: Buffer) {
                buffBody.push(chunk);
                buffBodyLen += chunk.length;
            });
        }

        let closeCallback = () => {
            if (httpError) {
                reject(httpError);
                return;
            }

            let body = Buffer.concat(buffBody, buffBodyLen);
            if (response.statusCode === 200) {
                if (savePath) {
                    if (body.length) {
                        fs.writeFileSync(savePath, body);
                        body = Buffer.from(savePath);
                    } else {
                        body = Buffer.from("");
                    }
                }
            } else if (response.headers['x-plantuml-diagram-error']) {
                httpError = parsePlantumlError(
                    response.headers['x-plantuml-diagram-error'],
                    parseInt(response.headers['x-plantuml-diagram-error-line']),
                    response.headers['x-plantuml-diagram-description'],
                    diagram
                );
            } else if (response.statusCode === 405) {
                reject(ERROR_405);
                return;
            } else {
                httpError = response.statusCode + " " + response.statusMessage + "\n\n" +
                    method + " " + requestPath;
            }
            if (httpError) {
                reject(<RenderError>{ error: httpError, out: body });
                return;
            }
            resolve(body);
        };

        let req = u.protocol == "http:" ?
            http.request(options, responseCallback) :
            https.request(options, responseCallback)

        req.on('error', (err: Error) => {
            httpError = err;
        });

        req.on('close', closeCallback);

        let includes: string[] = getIncludes(diagram)

        let upperParent: string = diagram.path;

        for (let f in includes) {
            upperParent = commonParent(upperParent, f);
        }


        let json = createJson(format, "", "");

        if (method == "POST") {
            req.write(json, "utf8");
        }
        req.end();
    });
}

function commonParent(path1: string, path2: string): string {
    let length: number = path1.length;
    
    let commonParent: string = "";
    for(let i = 0; i < length; i++) {
        if(path1.charAt(i) == path2.charAt(i)) {
            commonParent = commonParent + path1.charAt(i);
        } else {
            break;
        }
    }
    return commonParent;
}

function createJson(format: string, mainF: string, dataStr: string): string {
    let json_obj = {
        responseFormat: format.toUpperCase(),
        inputFormat: "ARCHIVE",
        archiveType: "AUTO_DETECT",
        mainFile: mainF,
        data: dataStr
    }

    return JSON.stringify(json_obj);
}

function parsePlantumlError(error: string, line: number, description: string, diagram: Diagram): any {
    if (diagramStartReg.test(diagram.lines[0])) line += 1;
    let fileLine = line;
    let blankLineCount = 0;
    for (let i = 1; i < diagram.lines.length; i++) {
        if (diagram.lines[i].trim()) break;
        blankLineCount++;
    }
    fileLine += blankLineCount;
    let lineContent = diagram.lines[fileLine - 1];
    fileLine += diagram.start.line;
    return `${error} (@ Diagram Line ${line}, File Line ${fileLine})\n"${lineContent}"\n${description}\n`;
}