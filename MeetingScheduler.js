require('dotenv').config(); // Load environment variables from .env file
const readline = require('readline'); // Readline utility to get user input
const OpenAI = require('openai');
const { getEvents } = require('./googleCalendarUtil');


// getEvents('sravankumar.dandra@celigo.com').then((events) => {
//   console.log(events)
// });



// let createAssistant = require('./assistantAPIUtils');

async function createAssistant(client) {
  let assistant = await client.beta.assistants.create({
    model: "gpt-4",
    name: "Meeting Scheduler",
    instructions: `
    This assistant takes instructions to schedule a meeting between multiple employees in your organization. 
    It will fetch public calendar events of each employee along with start and end time and will schedule the meeting according to availability.
    Only suggest time which is available to all participants.`,
    tools: [{
      "type": "function",
      "function": {
        "name": "getCalendarEvents",
        "description": "Gets list of events along with their start and end time from the calendar.",
        "parameters": {
          "type": "object",
          "properties": {
            "emailIds": { "type": "string", "description": "comma separated emailIds for whom scheduling needs to be done" },
            "startTime": { "type": "string", "description": "start time of the calendar in iso format" },
            "endTime": { "type": "string", "description": "end time of the calendar in iso format" },
          },
          "required": ["emailIds", "startTime", "endTime"]
        }
      }
    }]
  });
  return assistant;
}

const openai_key = process.env.OPENAI_API_KEY; // Get OpenAI API key from environment variables
const client = new OpenAI({ api_key: openai_key });
// Create a new assistant
var assistant, myThread;

async function init() {
  if (!assistant)
    assistant = await createAssistant(client);
  if (!myThread)
    myThread = await client.beta.threads.create();
}

async function main(question) {
  await init();

  let myMessageThread = await client.beta.threads.messages.create((thread_id = myThread.id), { role: "user", content: question });
  //console.log("Message created: " + myMessageThread.id);

  let myRun = await client.beta.threads.runs.create((thread_id = myThread.id),
    {
      assistant_id: assistant.id,
      instructions: `Address the user as SJ. Email id is 'saurabh.jain@celigo.com', Today is 2023-12-03T19:40:00+05:30}. working hours are 10:00 AM to 07:30 PM.`,
    }
  );
  //console.log("Run created: " + myRun.id);

  let retrieveRun = async function () {
    let keepRetrievingRun;

    while (myRun.status != "completed") {
      let keepRetrievingRun = await client.beta.threads.runs.retrieve((thread_id = myThread.id), (run_id = myRun.id));
      process.stdout.write(".");
      
      if (keepRetrievingRun.status == "requires_action") {

        let tool_calls = keepRetrievingRun.required_action.submit_tool_outputs.tool_calls;
        let call_id = tool_calls[0].id;
        function_arguments = JSON.parse(tool_calls[0].function.arguments);
        let emailIds = function_arguments.emailIds.split(',');
        let startTime = function_arguments.startTime;
        let endTime = function_arguments.endTime;
        let events = '';
        for (emailId of emailIds) {
          events += '\n' + emailId + ' busy schedule is as follows\n';
          events += await getEvents(emailId, startTime, endTime);
          events += '\n';
        }

        console.log('events',events);

        await client.beta.threads.runs.submitToolOutputs(
          thread_id=myThread.id,
          run_id=myRun.id,
          {
            tool_outputs:[
              {
                "tool_call_id": call_id,
                "output": events,
              }
            ]
          }
    
        )
      }
      
      if (keepRetrievingRun.status == "completed") {
        //console.log("Run completed");
        break;
      }
    }
  }


  await retrieveRun();

  let waitForAssistantMessage = async function () {
    await retrieveRun();
    const allMessages = await client.beta.threads.messages.list((thread_id = myThread.id));
    return allMessages.data[0].content[0].text.value
  }
  return await waitForAssistantMessage()
}


const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Function to ask a question and get user input
function askQuestion() {
  rl.question('Schedule a meeting (eg. Find a meetineg time between me, sravankumar.dandra@celigo.com & ritumoni.sarma@celigo.com on tuesday afternoon for 15 mins): ', async (question) => {
    // You can replace this with a function that provides an answer based on the question
    const answer = await main(question);
    console.log(`Answer: ${answer}`);
    console.log(
      "------------------------------------------------------------ \n"
    );
    askQuestion()
  });
}

console.log(`Welcome to the Meeting Scheduler Assistant!`);
// // Start the utility
askQuestion();