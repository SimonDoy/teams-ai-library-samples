import { Application, AI, PredictedSayCommand, PredictedDoCommand } from '@microsoft/teams-ai';

/**
 *
 * @param app
 */
export function addResponseFormatter(app: Application): void {
    app.ai.action<PredictedDoCommand>(AI.DoCommandActionName, async (context, state, data) => {
        console.log('do command', data);
        return ''
    });
    app.ai.action<PredictedSayCommand>(AI.SayCommandActionName, async (context, state, data) => {
        // Replace markdown code blocks with <pre> tags
        console.log('command: ' + AI.SayCommandActionName, data);
        
        let addTag = false;
        let inCodeBlock = false;
        const output: string[] = [];
        const response = data.response.split('\n');
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

        // Send response
        const formattedResponse = output.join('<br/>');
        await context.sendActivity(formattedResponse);

        return '';
    });
}
