from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage, SystemMessage

def get_chat_llm(temperature=0.0, max_output_tokens=None):
    return ChatGoogleGenerativeAI(
        model="gemini-2.0-flash",
        temperature=temperature,
    )

llm = get_chat_llm()
result = llm.invoke([HumanMessage(content="Hello")])
