import * as fs from "fs";
import * as vscode from "vscode";

import {
  promptInitialization,
  showErrorMessage,
  showInformationMessage
} from "../helpers/userInteraction";
import Extension from "../models/extension";
import {
  extendsAnotherObject,
  hasObjectTypeIDs,
  ObjectType,
  shouldBeObjectTypeIgnored,
  translateObjectType,
  translateObjectTypeFromObjectType
} from "../models/objectType";
import { CreateBCExtensionObjectRequest } from "../services/api/IIntegrationApi";
import ExtensionService from "../services/extensionService";
import { getCurrentWorkspaceUri } from "../services/fileService";

let extension: Extension | null;
export default async function synchronizeCommand(): Promise<void> {
  synchronize();
}

export async function synchronize(switchIDs = false): Promise<void> {
  try {
    const workspaceUri = getCurrentWorkspaceUri();
    const service = new ExtensionService();

    extension = await service.getExtension(workspaceUri);
    if (extension === null) {
      promptInitialization();
      return;
    }

    if (switchIDs && extension.alternateRangeCode === "") {
      throw new Error("The extension does not have alternate range defined!");
    }

    const workspaceFolderPath = workspaceUri.fsPath + "/src";
    console.log(workspaceFolderPath);

    if (!fs.existsSync(workspaceFolderPath)) {
      throw new Error("AL Project does not have src directory!");
    }

    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Synchronizing...",
        cancellable: false,
      },
      async (progress) => {
        const [success, errors] = await scanDirectory(
          workspaceFolderPath,
          switchIDs,
        );
        progress.report({ increment: 100 });
        if (switchIDs) {
          if (!success) {
            console.log(errors);
            showErrorMessage(
              `Some of object/field IDs of ${extension?.code} weren't switched due to following problems:\n` +
              errors,
            );
          } else {
            showInformationMessage(
              `All object & field IDs of ${extension?.code} were switched successfully!`,
            );
          }
        } else {
          if (!success) {
            console.log(errors);
            showErrorMessage(
              `Synchronization of ${extension?.code} has finished with errors:\n` +
              errors,
            );
          } else {
            showInformationMessage(
              `Synchronization of ${extension?.code} successful!`,
            );
          }
        }
      },
    );
  } catch (error) {
    showErrorMessage(error);
  }
  return;
}

async function scanDirectory(
  workspaceFolderPath: string,
  switchIDs: boolean,
): Promise<[boolean, string]> {
  let success = true;
  let errorStrings = "";
  const fs = require("fs");
  const files = fs.readdirSync(workspaceFolderPath);
  const replaceInFile = require("replace-in-file");

  console.log("Scanning directory: " + workspaceFolderPath);
  let scannedItemWithFullPath: string;
  let fileLines: string[], fileLine: string;
  let objectType: string;
  let oldObjectID, newObjectID, oldFieldID, newFieldID: number;
  let scanForObject;
  let scanForObjectFields: boolean,
    scanForObjectValues: boolean,
    ignoredObjectType: boolean;
  for (const fileOrDirName of files) {
    objectType = "";
    oldObjectID = 0;
    newObjectID = 0;
    oldFieldID = 0;
    newFieldID = 0;
    scanForObject = true;
    ignoredObjectType = false;
    scanForObjectValues = false;
    scanForObjectFields = false;
    scannedItemWithFullPath = workspaceFolderPath + "/" + fileOrDirName;
    if (fs.lstatSync(scannedItemWithFullPath).isDirectory()) {
      const [results, returnedErrors] = await scanDirectory(
        scannedItemWithFullPath,
        switchIDs,
      );
      if (!results) {
        errorStrings += returnedErrors;
        success = false;
      }
    } else {
      const extPosition = scannedItemWithFullPath.lastIndexOf(".");
      if (
        extPosition >= 0 &&
        scannedItemWithFullPath.substr(extPosition) === ".al"
      ) {
        const data = fs
          .readFileSync(scannedItemWithFullPath, "utf8")
          .toString();

        let inFieldsSection = false,
          inFieldOrValueSection = false;
        let noOfOpenBrackets = 0,
          counter = 0;
        fileLines = data.split("\n");
        // eslint-disable-next-line no-constant-condition
        while (true) {
          try {
            fileLine = fileLines[counter];

            if (scanForObject) {
              // Scan for objects
              if (scanForObject) {
                [objectType, oldObjectID, newObjectID, ignoredObjectType] =
                  await tryScanObject(fileOrDirName, fileLine, switchIDs);
                if (ignoredObjectType) {
                  break;
                }

                if (
                  objectType !== "" &&
                  (!hasObjectTypeIDs(translateObjectType(objectType)) ||
                    oldObjectID !== 0)
                ) {
                  scanForObject = false;

                  // If the file is not tableextension nor enumextension, do not parse the rest of file
                  switch (translateObjectType(objectType)) {
                    case ObjectType.TableExtension:
                      scanForObjectFields = true;
                      break;
                    case ObjectType.EnumExtension:
                      scanForObjectValues = true;
                      break;
                  }

                  // Object found
                  if (
                    !scanForObject &&
                    switchIDs &&
                    newObjectID !== 0 &&
                    oldObjectID !== 0
                  ) {
                    try {
                      const replaceOptions = {
                        files: scannedItemWithFullPath,
                        from: [objectType + " " + oldObjectID + " "],
                        to: [objectType + " " + newObjectID + " "],
                      };
                      replaceInFile(replaceOptions);
                    } catch (error) {
                      throw new Error(
                        "ID " +
                        oldObjectID +
                        " in file " +
                        scannedItemWithFullPath +
                        " can not be replaced by " +
                        newObjectID +
                        ".",
                      );
                    }
                  }

                  if (!scanForObjectFields && !scanForObjectValues) {
                    break;
                  }
                }
              }
            } else if (scanForObjectFields) {
              // Scan for fields of table extension
              [
                inFieldsSection,
                inFieldOrValueSection,
                noOfOpenBrackets,
                oldFieldID,
                newFieldID,
              ] = await scanObjectFields(
                fileLine,
                objectType,
                oldObjectID,
                inFieldsSection,
                inFieldOrValueSection,
                noOfOpenBrackets,
                switchIDs,
              );
              if (switchIDs && oldFieldID !== 0 && newFieldID !== 0) {
                try {
                  const replaceOptions = {
                    files: scannedItemWithFullPath,
                    from: ["field(" + oldFieldID + ";"],
                    to: ["field(" + newFieldID + ";"],
                  };
                  replaceInFile(replaceOptions);
                } catch (error) {
                  throw new Error(
                    "Field ID " +
                    oldFieldID +
                    " in file " +
                    scannedItemWithFullPath +
                    " can not be replaced by " +
                    newFieldID +
                    ".",
                  );
                }
              }
            } else if (scanForObjectValues) {
              // Scan for values of enum extension
              [
                inFieldOrValueSection,
                noOfOpenBrackets,
                oldFieldID,
                newFieldID,
              ] = await scanObjectValues(
                fileLine,
                objectType,
                oldObjectID,
                inFieldOrValueSection,
                noOfOpenBrackets,
                switchIDs,
              );
              if (switchIDs && oldFieldID !== 0 && newFieldID !== 0) {
                try {
                  const replaceOptions = {
                    files: scannedItemWithFullPath,
                    from: ["value(" + oldFieldID + ";"],
                    to: ["value(" + newFieldID + ";"],
                  };
                  replaceInFile(replaceOptions);
                } catch (error) {
                  throw new Error(
                    "Value ID " +
                    oldFieldID +
                    " in file " +
                    scannedItemWithFullPath +
                    " can not be replaced by " +
                    newFieldID +
                    ".",
                  );
                }
              }
            }

            counter++;
            if (counter >= fileLines.length) {
              if (scanForObject) {
                throw new Error(
                  "Could not determine file type, name or ID in file " +
                  scannedItemWithFullPath,
                );
              }
              if (
                scanForObjectFields &&
                (inFieldsSection ||
                  inFieldOrValueSection ||
                  noOfOpenBrackets > 0)
              ) {
                throw new Error(
                  "File " +
                  scannedItemWithFullPath +
                  " is not valid AL file or this file is not well-formated.",
                );
              }
              if (
                scanForObjectValues &&
                (inFieldOrValueSection || noOfOpenBrackets > 0)
              ) {
                throw new Error(
                  "File " +
                  scannedItemWithFullPath +
                  " is not valid AL file or this file is not well-formated.",
                );
              }
              break;
            }
          } catch (error) {
            success = false;
            errorStrings += ";\n" + error;
            break;
          }
        }
      }
    }
  }
  return [success, errorStrings];
}

async function tryScanObject(
  fileName: string,
  fileLine: String,
  switchIDs: boolean,
): Promise<[string, number, number, boolean]> {
  let objectID = "",
    objectName = "",
    extendsObjectName = "",
    tempString = "";
  const fileLineBySpace: string[] = fileLine.split(" ");
  const fileLineByQuotationMark: string[] = fileLine.split('"');
  const objectTypeString: string = fileLineBySpace[0];
  const objectType: ObjectType = translateObjectType(objectTypeString);
  if (objectType !== ObjectType.UnKnownObjectType) {
    if (shouldBeObjectTypeIgnored(objectType)) {
      return ["", 0, 0, true];
    }
    // Parse object ID & name
    if (hasObjectTypeIDs(objectType)) {
      objectID = fileLineBySpace[1];
      objectName = fileLineBySpace[2];
    } else {
      objectName = fileLineBySpace[1];
    }

    // Object name could have spaces in name, than it is marked with "
    const extendsObject = extendsAnotherObject(objectType);
    if (objectName.charAt(0) === '"') {
      objectName = fileLineByQuotationMark[1];
      if (extendsObject) {
        for (
          let counter = 2;
          counter < fileLineByQuotationMark.length;
          counter++
        ) {
          tempString += fileLineByQuotationMark[counter];
          if (fileLineByQuotationMark.length - 1 !== 2) {
            tempString += '"';
          }
        }
        tempString = tempString.trim();
        extendsObjectName = tempString.split(" ")[1];
      }
    } else if (extendsObject) {
      for (let counter = 4; counter < fileLineBySpace.length; counter++) {
        tempString += fileLineBySpace[counter];
      }
      tempString = tempString.trim();
      extendsObjectName = fileLineBySpace[4];
    }
    if (extendsObject) {
      // Extended object name could have spaces in name, than it is marked with "
      if (extendsObjectName.charAt(0) === '"') {
        extendsObjectName = tempString.split('"')[1];
      }
    }

    if (
      objectName === "" ||
      (objectID === "" && hasObjectTypeIDs(objectType)) ||
      (extendsObjectName === "" && extendsObject)
    ) {
      throw new Error("File " + fileName + " is not well-formated.");
    }

    // Register object
    const service = new ExtensionService();
    if (extension === null) {
      throw new Error("Can not create extension object for unknown extension.");
    }
    const createBCExtensionObjectRequest: CreateBCExtensionObjectRequest = {
      extension,
      objectType: translateObjectType(objectTypeString).toString(),
      objectID: +objectID,
      objectName,
      extendsObjectName,
    };

    console.log(
      "Registering Object type: " +
      createBCExtensionObjectRequest.objectType +
      ", object ID: " +
      createBCExtensionObjectRequest.objectID +
      ", object name: " +
      createBCExtensionObjectRequest.objectName,
    );
    await service.createExtensionObject(createBCExtensionObjectRequest);

    // Switch object IDs
    let oldID = +objectID;
    let newID = 0;
    if (switchIDs) {
      if (createBCExtensionObjectRequest.objectID !== 0) {
        const extensionObject = await service.getExtensionObject(
          extension.id,
          translateObjectTypeFromObjectType(
            translateObjectType(objectTypeString),
          ),
          +objectID,
        );

        if (extensionObject?.objectID === +objectID) {
          oldID = extensionObject?.objectID;
          newID = extensionObject?.alternateObjectID;
        } else {
          if (extensionObject?.alternateObjectID !== +objectID) {
            throw new Error("Object ID " + objectID + " can not be switched.");
          }
          oldID = extensionObject?.alternateObjectID;
          newID = extensionObject?.objectID;
        }
      }
    }
    return [objectTypeString, oldID, newID, false];
  }
  return ["", 0, 0, false];
}

async function scanObjectFields(
  fileLine: String,
  objectType: string,
  objectID: number,
  inFieldsSection: boolean,
  inFieldSection: boolean,
  noOfOpenBrackets: number,
  switchIDs: boolean,
): Promise<[boolean, boolean, number, number, number]> {
  let fieldID = "";
  let oldFieldID = 0;
  let newFieldID = 0;
  const service = new ExtensionService();
  if (fileLine.toLowerCase().trimStart().startsWith("fields")) {
    inFieldsSection = true;
  }
  if (inFieldsSection) {
    if (fileLine.trimStart().startsWith("{")) {
      noOfOpenBrackets += 1;
    }
    if (
      inFieldSection ||
      (noOfOpenBrackets === 1 &&
        fileLine.toLowerCase().trimStart().startsWith("field"))
    ) {
      if (
        !inFieldSection &&
        fileLine.toLowerCase().trimStart().startsWith("field")
      ) {
        fieldID = fileLine.split(";")[0];
        fieldID = fieldID.substr(fieldID.indexOf("(") + 1);
        await registerALFieldOrValueID(
          objectType,
          objectID.toString(),
          fieldID,
        );

        // Switch object field IDs
        if (switchIDs) {
          if (extension === null) {
            throw new Error(
              "Can not load extension object field for unknown extension.",
            );
          }
          const extensionObjectLine = await service.getExtensionObjectLine(
            extension.id,
            translateObjectTypeFromObjectType(translateObjectType(objectType)),
            +objectID,
            +fieldID,
          );

          if (extensionObjectLine?.fieldID === +fieldID) {
            oldFieldID = extensionObjectLine?.fieldID;
            newFieldID = extensionObjectLine?.alternateFieldID;
          } else {
            if (extensionObjectLine?.alternateFieldID !== +fieldID) {
              throw new Error(
                "Field ID " +
                fieldID +
                " in object ID " +
                objectID +
                " can not be switched.",
              );
            }
            oldFieldID = extensionObjectLine?.alternateFieldID;
            newFieldID = extensionObjectLine?.fieldID;
          }
        }
      }

      inFieldSection = true;
      if (fileLine.trimStart().startsWith("}")) {
        inFieldSection = false;
      }
    }
    if (fileLine.trimStart().startsWith("}")) {
      noOfOpenBrackets -= 1;
      if (!inFieldSection && noOfOpenBrackets <= 0) {
        inFieldsSection = false;
      }
    }
  }
  return [
    inFieldsSection,
    inFieldSection,
    noOfOpenBrackets,
    oldFieldID,
    newFieldID,
  ];
}

async function scanObjectValues(
  fileLine: String,
  objectType: string,
  objectID: number,
  inValueSection: boolean,
  noOfOpenBrackets: number,
  switchIDs: boolean,
): Promise<[boolean, number, number, number]> {
  let valueID = "";
  let oldValueID = 0;
  let newValueID = 0;
  const service = new ExtensionService();
  if (fileLine.trimStart().startsWith("{")) {
    noOfOpenBrackets += 1;
  }
  if (
    inValueSection ||
    (noOfOpenBrackets === 1 &&
      fileLine.toLowerCase().trimStart().startsWith("value"))
  ) {
    if (
      !inValueSection &&
      fileLine.toLowerCase().trimStart().startsWith("value")
    ) {
      valueID = fileLine.split(";")[0];
      valueID = valueID.substr(valueID.indexOf("(") + 1);
      await registerALFieldOrValueID(objectType, objectID.toString(), valueID);

      // Switch object field IDs
      if (switchIDs) {
        if (extension === null) {
          throw new Error(
            "Can not load extension object field for unknown extension.",
          );
        }
        const extensionObjectLine = await service.getExtensionObjectLine(
          extension.id,
          translateObjectTypeFromObjectType(translateObjectType(objectType)),
          +objectID,
          +valueID,
        );

        if (extensionObjectLine?.fieldID === +valueID) {
          oldValueID = extensionObjectLine?.fieldID;
          newValueID = extensionObjectLine?.alternateFieldID;
        } else {
          if (extensionObjectLine?.alternateFieldID !== +valueID) {
            throw new Error(
              "Field ID " +
              valueID +
              " in object ID " +
              objectID +
              " can not be switched.",
            );
          }
          oldValueID = extensionObjectLine?.alternateFieldID;
          newValueID = extensionObjectLine?.fieldID;
        }
      }
    }

    inValueSection = true;
    if (fileLine.trimStart().startsWith("}")) {
      inValueSection = false;
    }
  }
  if (fileLine.trimStart().startsWith("}")) {
    noOfOpenBrackets -= 1;
  }
  return [inValueSection, noOfOpenBrackets, oldValueID, newValueID];
}

async function registerALFieldOrValueID(
  objectType: string,
  objectId: string,
  fieldOrValueID: string,
): Promise<void> {
  const service = new ExtensionService();
  console.log(" Field ID: " + fieldOrValueID);
  await service.createExtensionObjectLine(
    extension,
    translateObjectType(objectType),
    +objectId,
    "",
    +fieldOrValueID,
  );
}
