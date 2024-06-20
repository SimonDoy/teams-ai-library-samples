import { Application, AI, PredictedSayCommand, PredictedDoCommand, ClientCitation, Utilities } from '@microsoft/teams-ai';
import { AIEntity } from '@microsoft/teams-ai/lib/actions';
import { ActivityTypes, Channels } from 'botbuilder';

/**
 *
 * @param app
 */
export function addResponseFormatter(app: Application): void {
    app.ai.action<PredictedDoCommand>(AI.DoCommandActionName, async (context, state, data, action) => {
        console.log('do command', data);
        return ''
    });
    app.ai.action<PredictedSayCommand>(AI.SayCommandActionName, async (context, state, data, action) => {
        // Replace markdown code blocks with <pre> tags
        console.log('command: ' + AI.SayCommandActionName, data);

        if (!data.response?.content) {
            return '';
        }

        let feedbackLoopEnabled = app.options.ai?.enable_feedback_loop ? app.options.ai?.enable_feedback_loop : false;
        let addTag = false;
        let inCodeBlock = false;
        const output: string[] = [];
        const response = data.response.content?.split('\n');

        let content = data.response.content;
        const isTeamsChannel = context.activity.channelId === Channels.Msteams;

        if (isTeamsChannel) {
            content = content.split('\n').join('<br>');
        }

        if(response) {
            for (const line of response) {
                if (line.startsWith('```')) {
                    if (!inCodeBlock) {
                        // Add tag to start of next line
                        addTag = true;
                        inCodeBlock = true;
                    } else {
                        // Add tag to end of previous line
                        output[output.length - 1] += '</pre>';
                        addTag = false;
                        inCodeBlock = false;
                    }
                } else if (addTag) {
                    output.push(`<pre>${line}`);
                    addTag = false;
                } else {
                    output.push(line);
                }
            }
        }

        // If the response from AI includes citations, those citations will be parsed and added to the SAY command.
        let citations: ClientCitation[] | undefined = undefined;

        if (data.response.context && data.response.context.citations.length > 0) {
            citations = data.response.context!.citations.map((citation, i) => {
                return {
                    '@type': 'Claim',
                    position: `${i + 1}`,
                    appearance: {
                        '@type': 'DigitalDocument',
                        name: citation.title,
                        abstract: Utilities.snippet(citation.content, 500),
                        url: citation.url
                    }
                } as ClientCitation;
            });
        }

        // If there are citations, modify the content so that the sources are numbers instead of [doc1], [doc2], etc.
        const contentText = !citations ? content : Utilities.formatCitationsResponse(content);

        // If there are citations, filter out the citations unused in content.
        const referencedCitations = citations ? Utilities.getUsedCitations(contentText, citations) : undefined;

        await context.sendActivity({
            type: ActivityTypes.Message,
            text: contentText,
            ...(isTeamsChannel ? { channelData: { feedbackLoopEnabled: feedbackLoopEnabled } } : {}),
            entities: [
                {
                    type: 'https://schema.org/Message',
                    '@type': 'Message',
                    '@context': 'https://schema.org',
                    '@id': '',
                    additionalType: ['AIGeneratedContent'],
                    ...(referencedCitations ? { citation: referencedCitations } : {})
                }
            ] as AIEntity[]
        });

        return '';
    });
}
