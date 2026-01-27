import * as vscode from "vscode";

import App from "../models/app";
import AssignableRange from "../models/assignableRange";
import Extension from "../models/extension";
import ExtensionObject from "../models/extensionObject";
import ExtensionObjectLine from "../models/extensionObjectLine";
import { ObjectType } from "../models/objectType";
import {
  CreateBCExtensionObjectRequest,
  IIntegrationApi,
  IntegrationApiProvider,
} from "./api/IIntegrationApi";
import { readAppJson } from "./fileService";

export default class ExtensionService {
  private static cache: Record<string, Extension> = {}; // XXX not cleared when settings change
  private iIntegrationApi: IIntegrationApi;

  constructor() {
    this.iIntegrationApi = IntegrationApiProvider.api;
  }

  public async getExtension(workspace: vscode.Uri): Promise<Extension | null> {
    if (workspace.fsPath in ExtensionService.cache) {
      return ExtensionService.cache[workspace.fsPath];
    }
    const app = readAppJson(workspace);

    const extension = await this.iIntegrationApi.getBcExtension(app.id);
    if (extension === null) {
      return null;
    }
    ExtensionService.cache[workspace.fsPath] = extension;
    return extension;
  }

  public async getExtensionObject(
    extensionID: string,
    objectType: string,
    objectID: number,
  ): Promise<ExtensionObject | null> {
    return await this.iIntegrationApi.getBcExtensionObject(
      extensionID,
      objectType,
      objectID,
    );
  }

  public async getExtensionObjectLine(
    extensionID: string,
    objectType: string,
    objectID: number,
    fieldID: number,
  ): Promise<ExtensionObjectLine | null> {
    return await this.iIntegrationApi.getBcExtensionObjectLine(
      extensionID,
      objectType,
      objectID,
      fieldID,
    );
  }

  public async createExtension(
    workspace: vscode.Uri,
    app: App,
    rangeCode?: string,
  ): Promise<Extension> {
    const extension = await this.iIntegrationApi.createBcExtension({
      id: app.id,
      rangeCode: rangeCode ?? "",
      name: app.name.substring(0, 50),
      description: app.description.substring(0, 250),
    });
    ExtensionService.cache[workspace.fsPath] = extension;
    return extension;
  }

  public async createExtensionObject(
    createBCExtensionObjectRequest: CreateBCExtensionObjectRequest,
  ): Promise<number> {
    return await this.iIntegrationApi.createBcExtensionObject(
      createBCExtensionObjectRequest,
    );
  }

  public async createExtensionObjectLine(
    extension: Extension | null,
    objectType: ObjectType,
    objectId: number,
    extendsObjectName = "",
    existingFieldOrValueId = 0,
  ): Promise<number | null> {
    if (extension === null) {
      throw new Error(
        "Can not create extension object line for unknown extension.",
      );
    }

    return await this.iIntegrationApi.createBcExtensionObjectLine({
      extension,
      objectType: objectType.toString(),
      objectID: objectId,
      extendsObjectName: extendsObjectName,
      fieldOrValueID: existingFieldOrValueId
    });
  }

  public async getAllAssignableRanges(): Promise<AssignableRange[]> {
    return await this.iIntegrationApi.getAllAssignableRanges();
  }
}
