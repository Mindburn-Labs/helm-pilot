import re
import os

def clean_book():
    path = "CCUnpacked_Reference.md"
    if not os.path.exists(path): return
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()

    # The noise block includes 01-05 nav items, "Claude Code Unpacked", etc
    noise_patterns = [
        r"01\nThe Agent Loop",
        r"02\nArchitecture Explorer",
        r"03\nTool System",
        r"04\nCommand Catalog",
        r"05\nHidden Features",
        r"1,8[0-9]{2}(\+)?\s+FILES",
        r"5[0-9]{2}K(\+)?\s+LINES OF CODE",
        r"5[0-9](\+)?\s+TOOLS",
        r"9[0-9](\+)?\s+COMMANDS",
        r"Find all TODO.*?($|\n)",
        r"(Claude Code Unpacked|Ask DeepWiki|Featured on Hacker News)",
        r"What actually happens when you type a message into Claude Code\?.*?straight from the source\.",
        r"START EXPLORING\n↓",
        r"1\nI",
        r"From keypress to rendered response, step by step through the source\.",
    ]

    for pat in noise_patterns:
        text = re.sub(pat, "", text, flags=re.MULTILINE|re.DOTALL)

    # Clean up excess newlines
    text = re.sub(r'\n{3,}', '\n\n', text)
    
    with open(path, "w", encoding="utf-8") as f:
        f.write(text.strip())
        
if __name__ == '__main__':
    clean_book()
