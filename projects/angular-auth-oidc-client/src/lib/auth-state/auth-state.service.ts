import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { distinctUntilChanged } from 'rxjs/operators';
import { OpenIdConfiguration } from '../config/openid-configuration';
import { AuthResult } from '../flows/callback-context';
import { LoggerService } from '../logging/logger.service';
import { EventTypes } from '../public-events/event-types';
import { PublicEventsService } from '../public-events/public-events.service';
import { StoragePersistenceService } from '../storage/storage-persistence.service';
import { TokenValidationService } from '../validation/token-validation.service';
import { AuthenticatedResult } from './auth-result';
import { AuthStateResult } from './auth-state';

const DEFAULT_AUTHRESULT = { isAuthenticated: false, allConfigsAuthenticated: [] };

@Injectable()
export class AuthStateService {
  private authenticatedInternal$ = new BehaviorSubject<AuthenticatedResult>(DEFAULT_AUTHRESULT);

  get authenticated$(): Observable<AuthenticatedResult> {
    return this.authenticatedInternal$.asObservable().pipe(distinctUntilChanged());
  }

  constructor(
    private storagePersistenceService: StoragePersistenceService,
    private loggerService: LoggerService,
    private publicEventsService: PublicEventsService,
    private tokenValidationService: TokenValidationService
  ) {}

  setAuthenticatedAndFireEvent(configurations: OpenIdConfiguration[]): void {
    const result = this.composeAuthenticatedResult(configurations);
    this.authenticatedInternal$.next(result);
  }

  setUnauthenticatedAndFireEvent(configuration: OpenIdConfiguration): void {
    this.storagePersistenceService.resetAuthStateInStorage(configuration);

    const result = this.composeUnAuthenticatedResult([configuration]);
    this.authenticatedInternal$.next(result);
  }

  updateAndPublishAuthState(authenticationResult: AuthStateResult): void {
    this.publicEventsService.fireEvent<AuthStateResult>(EventTypes.NewAuthenticationResult, authenticationResult);
  }

  setAuthorizationData(accessToken: string, authResult: AuthResult, configuration: OpenIdConfiguration): void {
    this.loggerService.logDebug(configuration, `storing the accessToken '${accessToken}'`);

    this.storagePersistenceService.write('authzData', accessToken, configuration);
    this.persistAccessTokenExpirationTime(authResult, configuration);
    this.setAuthenticatedAndFireEvent([configuration]);
  }

  getAccessToken(configuration: OpenIdConfiguration): string {
    if (!this.isAuthenticated(configuration)) {
      return null;
    }

    const token = this.storagePersistenceService.getAccessToken(configuration);

    return this.decodeURIComponentSafely(token);
  }

  getIdToken(configuration: OpenIdConfiguration): string {
    if (!this.isAuthenticated(configuration)) {
      return null;
    }

    const token = this.storagePersistenceService.getIdToken(configuration);

    return this.decodeURIComponentSafely(token);
  }

  getRefreshToken(configuration: OpenIdConfiguration): string {
    if (!this.isAuthenticated(configuration)) {
      return null;
    }

    const token = this.storagePersistenceService.getRefreshToken(configuration);

    return this.decodeURIComponentSafely(token);
  }

  getAuthenticationResult(configuration: OpenIdConfiguration): any {
    if (!this.isAuthenticated(configuration)) {
      return null;
    }

    return this.storagePersistenceService.getAuthenticationResult(configuration);
  }

  areAuthStorageTokensValid(configuration: OpenIdConfiguration): boolean {
    if (!this.isAuthenticated(configuration)) {
      return false;
    }

    if (this.hasIdTokenExpiredAndRenewCheckIsEnabled(configuration)) {
      this.loggerService.logDebug(configuration, 'persisted idToken is expired');

      return false;
    }

    if (this.hasAccessTokenExpiredIfExpiryExists(configuration)) {
      this.loggerService.logDebug(configuration, 'persisted accessToken is expired');

      return false;
    }

    this.loggerService.logDebug(configuration, 'persisted idToken and accessToken are valid');

    return true;
  }

  hasIdTokenExpiredAndRenewCheckIsEnabled(configuration: OpenIdConfiguration): boolean {
    const { renewTimeBeforeTokenExpiresInSeconds, enableIdTokenExpiredValidationInRenew } = configuration;

    if (!enableIdTokenExpiredValidationInRenew) {
      return false;
    }
    const tokenToCheck = this.storagePersistenceService.getIdToken(configuration);

    const idTokenExpired = this.tokenValidationService.hasIdTokenExpired(tokenToCheck, configuration, renewTimeBeforeTokenExpiresInSeconds);

    if (idTokenExpired) {
      this.publicEventsService.fireEvent<boolean>(EventTypes.IdTokenExpired, idTokenExpired);
    }

    return idTokenExpired;
  }

  hasAccessTokenExpiredIfExpiryExists(configuration: OpenIdConfiguration): boolean {
    const { renewTimeBeforeTokenExpiresInSeconds, configId } = configuration;
    const accessTokenExpiresIn = this.storagePersistenceService.read('access_token_expires_at', configuration);
    const accessTokenHasNotExpired = this.tokenValidationService.validateAccessTokenNotExpired(
      accessTokenExpiresIn,
      configuration,
      renewTimeBeforeTokenExpiresInSeconds
    );

    const hasExpired = !accessTokenHasNotExpired;

    if (hasExpired) {
      this.publicEventsService.fireEvent<boolean>(EventTypes.TokenExpired, hasExpired);
    }

    return hasExpired;
  }

  isAuthenticated(configuration: OpenIdConfiguration): boolean {
    return !!this.storagePersistenceService.getAccessToken(configuration) && !!this.storagePersistenceService.getIdToken(configuration);
  }

  private decodeURIComponentSafely(token: string): string {
    if (token) {
      return decodeURIComponent(token);
    } else {
      return '';
    }
  }

  private persistAccessTokenExpirationTime(authResult: any, configuration: OpenIdConfiguration): void {
    if (authResult?.expires_in) {
      const accessTokenExpiryTime = new Date(new Date().toUTCString()).valueOf() + authResult.expires_in * 1000;
      this.storagePersistenceService.write('access_token_expires_at', accessTokenExpiryTime, configuration);
    }
  }

  private composeAuthenticatedResult(configurations: OpenIdConfiguration[]): AuthenticatedResult {
    if (configurations.length === 1) {
      const { configId } = configurations[0];

      return { isAuthenticated: true, allConfigsAuthenticated: [{ configId, isAuthenticated: true }] };
    }

    return this.checkAllConfigsIfTheyAreAuthenticated(configurations);
  }

  private composeUnAuthenticatedResult(configurations: OpenIdConfiguration[]): AuthenticatedResult {
    if (configurations.length === 1) {
      const { configId } = configurations[0];

      return { isAuthenticated: false, allConfigsAuthenticated: [{ configId, isAuthenticated: false }] };
    }

    return this.checkAllConfigsIfTheyAreAuthenticated(configurations);
  }

  private checkAllConfigsIfTheyAreAuthenticated(configurations: OpenIdConfiguration[]): AuthenticatedResult {
    const allConfigsAuthenticated = configurations.map((config) => ({
      configId: config.configId,
      isAuthenticated: this.isAuthenticated(config),
    }));

    const isAuthenticated = allConfigsAuthenticated.every((x) => !!x.isAuthenticated);

    return { allConfigsAuthenticated, isAuthenticated };
  }
}
