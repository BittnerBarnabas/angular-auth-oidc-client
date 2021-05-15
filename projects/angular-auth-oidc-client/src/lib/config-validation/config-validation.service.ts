import { Injectable } from '@angular/core';
import { OpenIdConfiguration } from '../config/openid-configuration';
import { LoggerService } from '../logging/logger.service';
import { Level, RuleValidationResult } from './rule';
import { allRules } from './rules';
import { allMultipleConfigRules } from './rules/index';

@Injectable()
export class ConfigValidationService {
  constructor(private loggerService: LoggerService) {}

  validateConfigs(passedConfigs: OpenIdConfiguration[]): boolean {
    const result = passedConfigs.map((passedConfig) => this.validateConfigInternal(passedConfig, allMultipleConfigRules));

    return result.every((x) => x === true);
  }

  validateConfig(passedConfig: OpenIdConfiguration): boolean {
    return this.validateConfigInternal(passedConfig, allRules);
  }

  private validateConfigInternal(passedConfig: OpenIdConfiguration, allRulesToUse: any[]): boolean {
    const allValidationResults = allRulesToUse.map((rule) => rule(passedConfig));

    const errorCount = this.processValidationResultsAndGetErrorCount(allValidationResults, passedConfig.configId);

    return errorCount === 0;
  }

  private processValidationResultsAndGetErrorCount(allValidationResults: RuleValidationResult[], configId: string) {
    const allMessages = allValidationResults.filter((x) => x.messages.length > 0);

    const allErrorMessages = this.getAllMessagesOfType('error', allMessages);
    const allWarnings = this.getAllMessagesOfType('warning', allMessages);
    allErrorMessages.forEach((message) => this.loggerService.logError(configId, message));
    allWarnings.forEach((message) => this.loggerService.logWarning(configId, message));

    return allErrorMessages.length;
  }

  private getAllMessagesOfType(type: Level, results: RuleValidationResult[]) {
    const allMessages = results.filter((x) => x.level === type).map((result) => result.messages);
    return allMessages.reduce((acc, val) => acc.concat(val), []);
  }
}
