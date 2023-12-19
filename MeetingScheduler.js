require('dotenv').config(); // Load environment variables from .env file
const readline = require('readline'); // Readline utility to get user input
const OpenAI = require('openai');
const { getEvents } = require('./googleCalendarUtil');

const openaiKey = process.env.OPENAI_API_KEY; // Get OpenAI API key from environment variables
const client = new OpenAI({ api_key: openaiKey });

let assistant = {id: 'asst_TJSkXgVOD7rIRPYEz4G3ipSt'}, myThread;

async function createAssistant(client) {
  const assistantConfig = {
    model: "gpt-4",
    name: "Meeting Scheduler",
    instructions: `
      This assistant takes instructions to schedule a meeting between multiple employees in your organization. 
      It will fetch public calendar events of each employee along with start and end time and will schedule the meeting according to availability.
      Only suggest time which is available to all participants.`,
    tools: [
      {type: "code_interpreter"},
      {
      type: "function",
      function: {
        name: "getCalendarEvents",
        description: "Gets list of events along with their start and end time from the calendar.",
        parameters: {
          type: "object",
          properties: {
            emailIds: { type: "string", description: "comma separated emailIds for whom scheduling needs to be done" },
            startTime: { type: "string", description: "start time of the calendar in iso format" },
            endTime: { type: "string", description: "end time of the calendar in iso format" },
          },
          required: ["emailIds", "startTime", "endTime"]
        }
      }
    }]
  };

  assistant = await client.beta.assistants.create(assistantConfig);
  return assistant;
}

async function initialize() {
  if (!assistant) {
    // assistant = await createAssistant(client);
  }

  if (!myThread) {
    myThread = await client.beta.threads.create();
  }
}

async function runAssistant(question) {
  await initialize();

  await client.beta.threads.messages.create(myThread.id, { role: "user", content: question });

  const runConfig = {
    assistant_id: assistant.id,
    instructions: `Address the user as SJ. Email id is 'saurabh.jain@celigo.com', Today is ${new Date().toLocaleDateString()}T00:00:00+05:30}. working hours are 10:00 AM to 07:30 PM.`,
  };

  const myRun = await client.beta.threads.runs.create(myThread.id, runConfig);

  const retrieveRun = async () => {
    while (myRun.status !== "completed") {
      const keepRetrievingRun = await client.beta.threads.runs.retrieve(myThread.id, myRun.id);

      if (keepRetrievingRun.status === "requires_action") {
        const toolCalls = keepRetrievingRun.required_action.submit_tool_outputs.tool_calls;
        const callId = toolCalls[0].id;
        const functionArguments = JSON.parse(toolCalls[0].function.arguments);
        const emailIds = functionArguments.emailIds.split(',');
        const startTime = functionArguments.startTime;
        const endTime = functionArguments.endTime;
        let events = '';

        for (const emailId of emailIds) {
          events += `\n${emailId} busy schedule is as follows\n`;
          events += await getEvents(emailId, startTime, endTime);
          events += '\n';
        }

        console.log('events', events);

        await client.beta.threads.runs.submitToolOutputs(
          myThread.id,
          myRun.id,
          {
            tool_outputs: [
              {
                tool_call_id: callId,
                output: events,
              }
            ]
          }
        );
      }

      if (keepRetrievingRun.status === "completed") {
        break;
      }
    }
  };

  await retrieveRun();

  const waitForAssistantMessage = async () => {
    await retrieveRun();
    const allMessages = await client.beta.threads.messages.list(myThread.id);
    return allMessages.data[0].content[0].text.value;
  };

  return await waitForAssistantMessage();
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion() {
  rl.question('Schedule a meeting (eg. Find a meeting time between me, sravankumar.dandra@celigo.com & ritumoni.sarma@celigo.com on Tuesday afternoon for 15 mins): ', async (question) => {
    const answer = await runAssistant(question);
    console.log(`Answer: ${answer}`);
    console.log("------------------------------------------------------------ \n");
    askQuestion();
  });
}

console.log(`Welcome to the Meeting Scheduler Assistant!`);
askQuestion();