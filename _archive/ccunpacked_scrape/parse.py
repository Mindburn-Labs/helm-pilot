import json
import os
import bs4
import difflib

def get_added_text(initial_text_lines, new_text_lines):
    matcher = difflib.SequenceMatcher(None, initial_text_lines, new_text_lines)
    added_lines = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag in ('replace', 'insert'):
            added_lines.extend(new_text_lines[j1:j2])
    return "\n".join(added_lines)

def main():
    if not os.path.exists('output/summary.json'):
        print("No summary.json found")
        return
        
    with open('output/initial.html', 'r', encoding='utf-8') as f:
        initial_soup = bs4.BeautifulSoup(f.read(), 'html.parser')
        initial_text = initial_soup.get_text(separator="\n", strip=True)
        initial_lines = initial_text.split('\n')

    with open('output/summary.json', 'r', encoding='utf-8') as f:
        summary = json.load(f)
        
    book_lines = ["# CCUnpacked Reference Book", "", "A comprehensive dump of all expanded data from CCUnpacked.", ""]
    
    sections = {}
    for name, data in summary.items():
        sec = data['section']
        if sec not in sections:
            sections[sec] = []
        sections[sec].append((name, data))
        
    for sec, items in sections.items():
        book_lines.append(f"## {sec.replace('_', ' ').title()}")
        book_lines.append("")
        
        for i, (name, data) in enumerate(items):
            book_lines.append(f"### {name}")
            
            html_path = os.path.join('output', f"{sec}_{i}.html")
            if os.path.exists(html_path):
                with open(html_path, 'r', encoding='utf-8') as f:
                    soup = bs4.BeautifulSoup(f.read(), 'html.parser')
                    
                    # Look for dialogs first
                    dialogs = soup.select('[role="dialog"], dialog, .fixed.inset-0, .modal')
                    if dialogs:
                        expanded_text = "\n\n".join(d.get_text(separator="\n", strip=True) for d in dialogs if d.get_text(strip=True))
                    else:
                        # Fallback to diffing text
                        new_text = soup.get_text(separator="\n", strip=True)
                        new_lines = new_text.split('\n')
                        expanded_text = get_added_text(initial_lines, new_lines)
                        
                    if expanded_text.strip():
                        book_lines.append(expanded_text.strip())
                    else:
                        book_lines.append("_No additional content revealed_")
            else:
                book_lines.append("_Failed to capture state._")
            book_lines.append("")
            
    with open("CCUnpacked_Reference.md", "w", encoding="utf-8") as f:
        f.write("\n".join(book_lines))
        
    print("Markdown book created successfully at CCUnpacked_Reference.md")
    
if __name__ == '__main__':
    main()
