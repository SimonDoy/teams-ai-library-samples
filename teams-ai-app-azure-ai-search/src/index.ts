// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// Import required packages
import { config } from 'dotenv';
import * as path from 'path';
import * as restify from 'restify';

// Import required bot services.
// See https://aka.ms/bot-services to learn more about the different parts of a bot.
import {
    ConfigurationServiceClientCredentialFactory,
    MemoryStorage,
    ShowTypingMiddleware,
    TurnContext
} from 'botbuilder';

import { ActionPlanner, OpenAIModel, PromptManager, TurnState, Application, AI, TeamsAdapter } from '@microsoft/teams-ai';
import {AzureAISearchDataSource, AzureAISearchDataSourceOptions} from 'teams-ai-azure-ai-search-datasource';
import { addResponseFormatter } from './responseFormatter';

// Read botFilePath and botFileSecret from .env file.
const ENV_FILE = path.join(__dirname, '..', '.env');
config({ path: ENV_FILE });

// Create adapter.
// See https://aka.ms/about-bot-adapter to learn more about how bots work.
const adapter = new TeamsAdapter({},
    new ConfigurationServiceClientCredentialFactory({
        MicrosoftAppId: process.env.BOT_ID,
        MicrosoftAppPassword: process.env.BOT_PASSWORD,
        MicrosoftAppType: 'MultiTenant'
    }));


// Catch-all for errors.
const onTurnErrorHandler = async (context: TurnContext, error: Error) => {
    // This check writes out errors to console log .vs. app insights.
    // NOTE: In production environment, you should consider logging this to Azure
    //       application insights.
    console.error(`\n [onTurnError] unhandled error: ${error.toString()}`);
    console.log(error);

    // Send a trace activity, which will be displayed in Bot Framework Emulator
    await context.sendTraceActivity(
        'OnTurnError Trace',
        `${error.toString()}`,
        'https://www.botframework.com/schemas/error',
        'TurnError'
    );

    // Send a message to the user
    await context.sendActivity('The bot encountered an error or bug.');
    await context.sendActivity('To continue to run this bot, please fix the bot source code.');
};

// Set the onTurnError for the singleton CloudAdapter.
adapter.onTurnError = onTurnErrorHandler;

// add show typing middleware.
adapter.use(new ShowTypingMiddleware(6000, 500));

// Create HTTP server.
const server = restify.createServer();
server.use(restify.plugins.bodyParser());

server.listen(process.env.port || process.env.PORT || 3978, () => {
    console.log(`\n${server.name} listening to ${server.url}`);
    console.log('\nGet Bot Framework Emulator: https://aka.ms/botframework-emulator');
    console.log('\nTo test your bot in Teams, sideload the app manifest.json within Teams Apps.');
});


// Strongly type the applications turn state
interface ConversationState {
    data: string;
}
type ApplicationTurnState = TurnState<ConversationState>;

if (!process.env.OPENAI_KEY && !process.env.AZURE_OPENAI_KEY) {
    throw new Error('Missing environment variables - please check that OPENAI_KEY or AZURE_OPENAI_KEY is set.');
}

// Create AI components
const model = new OpenAIModel({
    // OpenAI Support
    apiKey: process.env.OPENAI_KEY!,
    defaultModel: process.env.AZURE_OPENAI_DEPLOYMENTMODEL,

    // Azure OpenAI Support
    azureApiKey: process.env.AZURE_OPENAI_KEY!,
    azureDefaultDeployment: process.env.AZURE_OPENAI_DEPLOYMENTMODEL!,
    azureEndpoint: process.env.AZURE_OPENAI_ENDPOINT!,
    azureApiVersion: '2023-12-01-preview',

    // Request logging
    logRequests: true
});

const prompts = new PromptManager({
    promptsFolder: path.join(__dirname, '../src/prompts')
});

const planner = new ActionPlanner({
    model,
    prompts,
    defaultPrompt: 'chat'
});

const dataSourceOptions: AzureAISearchDataSourceOptions = {
    azureOpenAiEndpoint: process.env.AZURE_OPENAI_ENDPOINT!,
    azureOpenAiKey: process.env.AZURE_OPENAI_KEY!,
    azureOpenAiDeploymentId: process.env.AZURE_OPENAI_DEPLOYMENTMODEL!,
    azureSearchEndpoint: process.env.AZURE_SEARCH_ENDPOINT!,
    azureSearchKey: process.env.AZURE_SEARCH_KEY!,
    azureSearchIndexName: process.env.AZURE_SEARCH_INDEXNAME!,   
};

console.log('AzureAISearchDataSource', AzureAISearchDataSource);
let dataSource:AzureAISearchDataSource = new AzureAISearchDataSource('teams-ai', dataSourceOptions);

planner.prompts.addDataSource(
    dataSource
);
// Define storage and application
// - Note that we're not passing a prompt in our AI options as we manually ask for hints.
const storage = new MemoryStorage();
const app = new Application<ApplicationTurnState>({
    storage,
    ai: {
        planner
    }
});

addResponseFormatter(app);

// List for /reset command and then delete the conversation state
app.message('/quit', async (context: TurnContext, state: ApplicationTurnState) => {
    state.deleteConversationState();
    await context.sendActivity("deleted conversations.");
});

// Register other AI actions
app.ai.action(
    AI.FlaggedInputActionName,
    async (context: TurnContext, state: ApplicationTurnState, data: Record<string, any>) => {
        await context.sendActivity(`I'm sorry your message was flagged: ${JSON.stringify(data)}`);
        return AI.StopCommandName;
    }
);

app.ai.action(AI.FlaggedOutputActionName, async (context: TurnContext, state: ApplicationTurnState, data: any) => {
    await context.sendActivity(`I'm not allowed to talk about such things.`);
    return AI.StopCommandName;
});

// Listen for incoming server requests.
server.post('/api/messages', async (req, res) => {
    // Route received a request to adapter for processing
    await adapter.process(req, res as any, async (context) => {
        // Dispatch to application for routing
        await app.run(context);
    });
});


