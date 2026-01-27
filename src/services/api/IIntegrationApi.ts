import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";

import {
  InvalidSettingsError,
  promptMissingSettings,
} from "../../helpers/userInteraction";
import AssignableRange from "../../models/assignableRange";
import Extension from "../../models/extension";
import ExtensionObject from "../../models/extensionObject";
import ExtensionObjectLine from "../../models/extensionObjectLine";
import BcClient from "../bcClient";
import { getAccessToken } from "../oauth";
import { Settings, SettingsProvider } from "../settings";
import IntegrationApiv1n0 from "./IntegrationApiv1n0";
import IntegrationApiv1n1 from "./IntegrationApiv1n1";

export type CreateBCExtensionRequest = {
  id: string;
  rangeCode: string;
  name: string;
  description: string;
};

export type CreateBCExtensionObjectRequest = {
  objectType: string;
  objectID: number;
  objectName: string;
  extendsObjectName: string;
  extension: Extension;
};

export type CreateBCExtensionObjectLineRequest = {
  objectType: string;
  objectID: number;
  fieldOrValueID: number;
  extendsObjectName: string;
  extension: Extension;
};

export interface IIntegrationApi {
  bcClient: BcClient;

  getBcExtension(id: string): Promise<Extension | null>;
  getBcExtensionObject(
    extensionID: string,
    objectType: string,
    objectID: number,
  ): Promise<ExtensionObject | null>;
  getBcExtensionObjectLine(
    extensionID: string,
    objectType: string,
    objectID: number,
    fieldID: number,
  ): Promise<ExtensionObjectLine | null>;

  createBcExtension(
    createBCExtensionRequest: CreateBCExtensionRequest,
  ): Promise<Extension>;
  createBcExtensionObject(
    createBCExtensionObjectRequest: CreateBCExtensionObjectRequest,
  ): Promise<number>;
  createBcExtensionObjectLine(
    createBCExtensionObjectLineRequest: CreateBCExtensionObjectLineRequest,
  ): Promise<number>;
  getAllAssignableRanges(): Promise<AssignableRange[]>;

  isDeprecated(): boolean;
}

export class IntegrationApiProvider {
  private static instance: IIntegrationApi | undefined;
  private static removeSettingsUpdateListener: () => void | undefined;

  static validate(): IIntegrationApi | undefined {
    try {
      return this.buildInstance();
    } catch {
      return undefined;
    }
  }

  static get api(): IIntegrationApi {
    if (this.instance) {
      return this.instance;
    }

    this.instance = this.buildInstance();
    return this.instance;
  }

  private static buildInstance(): IIntegrationApi {
    this.removeSettingsUpdateListener?.call(this);
    const { settings, removeListener } =
      SettingsProvider.getSettingsAndSubscribe(this.reset);
    this.removeSettingsUpdateListener = removeListener;

    try {
      return IntegrationApiProvider.buildIntegrationApi(settings);
    } catch (error) {
      if (error instanceof InvalidSettingsError) {
        promptMissingSettings(error.message);
      }
      throw error;
    }
  }

  private static reset(): void {
    this.instance = undefined;
    this.instance = this.buildInstance();
  }

  private static buildIntegrationApi(settings: Settings): IIntegrationApi {
    const bcClient = new BcClient({
      baseUrl: IntegrationApiProvider.buildBaseUrl(settings),
      tenant: settings.apiTenant,
      httpClient: IntegrationApiProvider.buildClient(settings),
    });

    switch (settings.apiVersion) {
      case "1.1":
        return new IntegrationApiv1n1(bcClient);
      case "1.0":
        return new IntegrationApiv1n0(bcClient);
      default:
        throw new InvalidSettingsError(
          `Invalid version ${settings.apiVersion}, supported values are: ['1.1', '1.0'].`,
        );
    }
  }

  private static buildBaseUrl(settings: Settings): string {
    switch (settings.apiType) {
      case "Cloud":
        return cloudUrl(settings);
      case "OnPrem":
        return userUrl(settings);
      default:
        throw new InvalidSettingsError(
          `Invalid apiType ${settings.apiType}, supported values are: ['OnPrem', 'Cloud'].`,
        );
    }
  }

  private static buildClient(settings: Settings): AxiosInstance {
    switch (settings.authenticationType) {
      case "Basic":
        return buildBasicAuthClient(settings);
      case "Oauth":
        return buildOauthClient(settings);
      default:
        throw new InvalidSettingsError(
          `Unimplemented authentication type: ${settings.authenticationType}`,
        );
    }
  }
}

function userUrl(settings: Settings): string {
  if (!settings.apiBaseUrl) {
    throw new InvalidSettingsError(`Invalid settings: Missing apiBaseUrl.`);
  }
  if (!settings.apiVersion) {
    throw new InvalidSettingsError(`Invalid settings: Missing apiVersion.`);
  }

  let baseUrl = settings.apiBaseUrl;
  if (!baseUrl.endsWith("/")) {
    baseUrl += "/";
  }
  baseUrl += `v${settings.apiVersion}/`;

  if (settings.apiCompanyId) {
    baseUrl += "companies(" + settings.apiCompanyId + ")/";
  }

  return baseUrl;
}

function cloudUrl(settings: Settings) {
  if (!settings.apiTenant) {
    throw new InvalidSettingsError(`Invalid settings: Missing apiTenant.`);
  }
  if (!settings.apiEnvironment) {
    throw new InvalidSettingsError(`Invalid settings: Missing apiEnvironment.`);
  }
  if (!settings.apiVersion) {
    throw new InvalidSettingsError(`Invalid settings: Missing apiVersion.`);
  }

  const tenant = settings.apiTenant;
  const environment = settings.apiEnvironment;
  const version = `v${settings.apiVersion}`;
  const companyId = settings.apiCompanyId;

  const url = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${environment}/api/teamARTAAAE/extension/${version}`;
  if (companyId) {
    return `${url}/companies(${companyId})`;
  }
  return url;
}

function buildBasicAuthClient(settings: Settings): AxiosInstance {
  const authorization: string = Buffer.from(
    `${settings.apiUsername}:${settings.apiPassword}`,
  ).toString("base64");

  return axios.create({
    headers: {
      authorization: `Basic ${authorization}`,
    },
  });
}

// wraps axios instance to replace request method to allow us to fetch token before each request
function buildOauthClient(settings: Settings): AxiosInstance {
  const client = axios.create();
  const innerRequest = client.request;

  client.request = async function wrappedRequest<T = any, R = AxiosResponse<T>>(
    config: AxiosRequestConfig,
  ): Promise<R> {
    const accessToken = await getAccessToken(settings.secretStorage);

    return innerRequest({
      ...config,
      headers: {
        ...config.headers,
        authorization: `Bearer ${accessToken}`,
      },
    });
  };

  return client;
}
