"""Revision tutor: asks questions from the chapter notes, grades spoken answers, gives a final score."""

import os

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

LLM_MODEL = "gpt-5.4-mini"
TOTAL_QUESTIONS = 5
OPENING_LINE = (
    "Hi {name}. I'm your science tutor. Today we'll revise the chapter {chapter}. "
    "Answer out loud, then tap Send when you're done. Here's your first one."
)

SYSTEM_PROMPT = """You are a warm, encouraging CBSE Class 10 Science tutor running a spoken revision session with {name} on the chapter "{chapter}".

How you work:
- Ask {total} short questions in total, one at a time, only from the chapter notes below.
- After each answer, say whether it was right, correct or complete it kindly in one or two sentences, then follow the instruction you are given.
- Everything you write is spoken aloud. Use plain conversational sentences: no markdown, lists, symbols or emojis. Keep each reply under 60 words.
- The student may answer in English, Hindi or Hinglish. Reply in the language they used.
- Stay strictly within the notes. Never make up facts.
- If the student asks or says anything outside this chapter, don't answer it. Kindly bring them back to the current question.
- You are talking to school students, so keep it friendly and age-appropriate: no profanity, and no sensitive or adult topics.
- Your replies are spoken aloud, so say formulas, symbols and numbers the way a teacher would read them out. For example, say "one by v plus one by u equals one by f", not "1/v + 1/u = 1/f", and "H two O", not "H2O".
- When the last question is done, or the student says they want to stop, give a warm well-done message, tell them their score, and say goodbye.

Chapter notes:
{notes}"""


class RevisionTutor:
    def __init__(self, name: str, chapter_title: str, notes: str) -> None:
        self.llm = ChatOpenAI(
            model=LLM_MODEL,
            api_key=os.getenv("OPENAI_API_KEY"),
            reasoning_effort="low",
            temperature=0.01,
        )
        self.messages = [SystemMessage(SYSTEM_PROMPT.format(
            name=name, chapter=chapter_title, total=TOTAL_QUESTIONS, notes=notes,
        ))]
        self.questions_answered = 0
        self.finished = False
        self.name = name
        self.chapter_title = chapter_title

    async def _ask(self, prompt: str) -> str:
        self.messages.append(HumanMessage(prompt))
        response = await self.llm.ainvoke(self.messages)
        reply = response.text.strip()
        self.messages.append(AIMessage(reply))
        return reply

    async def opening(self) -> str:
        greeting = OPENING_LINE.format(name=self.name, chapter=self.chapter_title)
        question = await self._ask("Ask question 1 only. Do not greet; the student has already been greeted.")
        return f"{greeting} {question}"

    async def reply(self, answer: str) -> str:
        self.questions_answered += 1
        if self.questions_answered < TOTAL_QUESTIONS:
            instruction = f"Give feedback, then ask question {self.questions_answered + 1}."
        else:
            self.finished = True
            instruction = (
                f"Give feedback, then end the session: give a score out of {TOTAL_QUESTIONS} "
                "and name the 1 or 2 topics to revisit. Do not ask another question."
            )
        return await self._ask(
            f"Student's answer to question {self.questions_answered}: {answer}\n\n(Instruction: {instruction})"
        )
