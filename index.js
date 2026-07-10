import { GoogleGenAI } from "@google/genai";
import readlineSync from "readline-sync";
import dotenv from "dotenv";
import { exec } from "child_process";
import { promisify } from "util";
import os from "os";

dotenv.config();

const asyncExec = promisify(exec);

const ai = new GoogleGenAI({
  apiKey: process.env.GOOGLE_API_KEY,
});

// executeCommand now RETURNS the actual output instead of returning
// the result of console.log/console.error (which is always undefined).
const executeCommand = async ({ command }) => {
  try {
    const { stdout, stderr } = await asyncExec(command);
    if (stderr) {
      console.error(`stderr: ${stderr}`);
    }
    console.log(`Command output: ${stdout}`);
    return stdout || stderr || "(command produced no output)";
  } catch (e) {
    console.error(`Error executing command: ${e.message}`);
    return `Error executing command: ${e.message}`;
  }
};

// Lives outside runAgent so it persists across multiple questions
// in the same session (this is your full conversation history).
const history = [];

const executeCommandDeclaration = {
  type: "function",
  name: "executeCommand",
  description:
    "Execute a shell command. A command can be any valid shell command, such as 'ls', 'pwd', 'echo Hello World', etc.",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description:
          "A single string containing the shell command to be executed. For example, 'ls', 'pwd', 'echo Hello World', etc.",
      },
    },
    required: ["command"],
  },
};

const runAgent = async (userInput) => {
  // Append this turn's question onto the persistent history instead of
  // creating a fresh array — this is what keeps prior Q&A in context.
  history.push({
    type: "user_input",
    content: [{ type: "text", text: userInput }],
  });

  while (true) {
    let response;
    try {
      response = await ai.interactions.create({
        model: "gemini-3.1-flash-lite",
        input: history,
        store: false,
        tools: [executeCommandDeclaration],
        system_instruction: `You are a website building assistant. You can execute shell commands to help the user build a website. Please provide clear and concise instructions for the user.
current user OS is ${os.type()} and version is ${os.release()}. Please provide the commands accordingly.

what is your job ->
1: Analyse the user input and understand the user's requirements.
2: Give them commands one by one.
3: Use available tools to execute the commands and provide the output to the user.`,
      });
    } catch (e) {
      console.error("API call failed:", e.message);
      return;
    }

    // Append every step the model returned (thought/function_call/etc.)
    // back into history exactly as received - required for stateless mode.
    history.push(...response.steps);

    const functionCallSteps = response.steps.filter(
      (step) => step.type === "function_call"
    );

    if (functionCallSteps.length === 0) {
      // No tool calls -> this is the final answer, print it and stop looping.
      console.log(`Assistant response: ${response.output_text}`);
      break;
    }

    // Ask before running anything the model wants to execute on your machine.
    for (const step of functionCallSteps) {
      console.log(`Function to call: ${step.name}`);
      console.log(`Arguments: ${JSON.stringify(step.arguments)}`);

      let result;
      if (step.name === "executeCommand") {
        const confirm = readlineSync.keyInYN(
          `Run command: "${step.arguments.command}"?`
        );
        result = confirm
          ? await executeCommand(step.arguments)
          : "User declined to run this command.";
      } else {
        result = `Unknown function: ${step.name}`;
      }

      history.push({
        type: "function_result",
        name: step.name,
        call_id: step.id,
        result: [{ type: "text", text: String(result) }],
      });
    }
    // loop again so the model can see the function_result and respond
  }
};

const main = async () => {
  const userInput = readlineSync.question("Enter your question: ");
  await runAgent(userInput);
  main();
};

main();