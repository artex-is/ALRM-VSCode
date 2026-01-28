import * as vscode from "vscode";

import {
  getUserInput,
  getUserSelection,
  promptInitialization,
  showErrorMessage,
} from "../helpers/userInteraction";
import {
  ObjectType,
  originalObjects,
  runtime04Objects,
  runtime05Objects,
  runtime06Objects,
  runtime07Objects,
  substituteObjectInfo,
} from "../models/objectType";
import ExtensionService from "../services/extensionService";
import {
  getCurrentWorkspaceUri,
  readAppJson,
  readSnippetFile,
} from "../services/fileService";
import { SettingsProvider } from "../services/settings";

export default async function newObjectCommand(): Promise<void> {
  try {
    const workspaceUri = getCurrentWorkspaceUri();
    const service = new ExtensionService();

    const extension = await service.getExtension(workspaceUri);
    if (extension === null) {
      promptInitialization();
      return;
    }

    const objectType = await promptObjectSelection();
    if (objectType === undefined) {
      return; // canceled
    }

    const snippetFileContent = readSnippetFile(objectType);

    const maxLength = 30;

    const objectName = await vscode.window.showInputBox({
      prompt: `Enter ${ObjectType[objectType]} name`,
      validateInput: (value: string) => {
        if (value.length > maxLength) {
          return `Maximum length of AL Object name has to be ${maxLength} chars. You entered ${value.length}.`;
        }
        return null;
      },
    });

    if (objectName === undefined) {
      return; // canceled
    }

    const newObjectId = await service.createExtensionObject({
      extension,
      objectType: objectType.toString(),
      objectID: 0,
      objectName,
      extendsObjectName: "",
    });
    if (newObjectId === null) {
      showErrorMessage("New object could not be created!");
      return;
    }

    await createObjectFile(
      snippetFileContent,
      objectType,
      objectName,
      newObjectId,
    );
  } catch (error) {
    showErrorMessage(error);
  }
}

async function promptObjectSelection(): Promise<ObjectType | undefined> {
  const workspaceUri = getCurrentWorkspaceUri();
  const app = readAppJson(workspaceUri);
  let objectTypesArray = originalObjects;
  if (app.runtime >= 4.0) {
    objectTypesArray = objectTypesArray.concat(runtime04Objects);
  }
  if (app.runtime >= 5.0) {
    objectTypesArray = objectTypesArray.concat(runtime05Objects);
  }
  if (app.runtime >= 6.0) {
    objectTypesArray = objectTypesArray.concat(runtime06Objects);
  }
  if (app.runtime >= 7.0) {
    objectTypesArray = objectTypesArray.concat(runtime07Objects);
  }

  const items: vscode.QuickPickItem[] = [];
  for (const objectTypeID of objectTypesArray) {
    items.push({
      label: ObjectType[objectTypeID],
    });
  }
  const selectedObjectType = await getUserSelection(items);
  if (selectedObjectType?.label === undefined) {
    return undefined;
  }
  return ObjectType[selectedObjectType?.label as keyof typeof ObjectType];
}

async function promptObjectSnippetSelection(
  objectType: ObjectType,
  snippetObject: Object,
): Promise<Object> {
  let firstPrefix = "";
  const items: vscode.QuickPickItem[] = [];
  const settings = SettingsProvider.getSettings();

  for (const [key, value] of Object.entries(snippetObject)) {
    let description = "";
    let prefix = "";
    if ("description" in value && typeof value["description"] === "string") {
      description = value["description"] as string;
    }
    if ("prefix" in value && typeof value["prefix"] === "string") {
      prefix = value["prefix"] as string;
      if (firstPrefix === "") {
        firstPrefix = prefix;
      }
    }
    if (
      prefix === "" ||
      settings.snippets.showALObjectSnippet(objectType, firstPrefix, prefix)
    ) {
      items.push({
        label: key,
        description: prefix,
        detail: description,
      });
    }
  }

  if (items.length === 1) {
    return snippetObject[
      Object.keys(snippetObject)[0] as keyof typeof snippetObject
    ];
  }
  const selectedObjectSnippet = await getUserSelection(items);
  if (selectedObjectSnippet?.label === undefined) {
    return snippetObject[
      Object.keys(snippetObject)[0] as keyof typeof snippetObject
    ];
  }
  return snippetObject[
    selectedObjectSnippet?.label as keyof typeof snippetObject
  ];
}

async function createObjectFile(
  snippetFileContent: Buffer,
  objectType: ObjectType,
  objectName: string,
  objectId: number,
) {
  const snippet = await buildObjectSnippet(
    snippetFileContent,
    objectType,
    objectName,
    objectId,
  );

  const textDocument = await vscode.workspace.openTextDocument({
    language: "al",
  });
  const textEditor = await vscode.window.showTextDocument(textDocument);
  textEditor.insertSnippet(snippet);
}

async function buildObjectSnippet(
  snippetFileContent: Buffer,
  objectType: ObjectType,
  objectName: string,
  objectId: number,
): Promise<vscode.SnippetString> {
  let snippetObject = JSON.parse(snippetFileContent.toString());
  if (typeof snippetObject !== "object") {
    throw new Error("Incorrect snippet file format!");
  }

  const numberOfSnippets = Object.keys(snippetObject).length;
  if (numberOfSnippets === 0) {
    throw new Error("Incorrect snippet file format!");
  } else if (numberOfSnippets > 1) {
    snippetObject = await promptObjectSnippetSelection(
      objectType,
      snippetObject,
    );
  } else {
    snippetObject = snippetObject[Object.keys(snippetObject)[0]];
  }
  if (!("body" in snippetObject) || !Array.isArray(snippetObject["body"])) {
    throw new Error("Incorrect snippet file format!");
  }

  const snippetLines = snippetObject["body"];

  snippetLines[0] = substituteObjectInfo(
    snippetLines[0],
    objectType,
    objectName,
    objectId.toString(),
  );
  const snippetString = new vscode.SnippetString(snippetLines.join("\n"));

  return snippetString;
}
