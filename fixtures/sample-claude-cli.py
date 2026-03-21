import asyncio
import shutil

def _find_claude():
    path = shutil.which("claude")
    return path

class Client:
    def __init__(self, model="sonnet", concurrency=5):
        self.model = model
        self.claude_bin = _find_claude()

    async def ask(self, system, user, response_model):
        cmd = [self.claude_bin, "-p", "--model", self.model]
        proc = await asyncio.create_subprocess_exec(*cmd)
        return proc

    async def ask_text(self, system, user):
        cmd = [self.claude_bin, "-p", "--model", self.model]
        proc = await asyncio.create_subprocess_exec(*cmd)
        return proc
