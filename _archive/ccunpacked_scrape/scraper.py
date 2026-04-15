import json
import time
import os
from playwright.sync_api import sync_playwright

output_dir = "output"
os.makedirs(output_dir, exist_ok=True)
os.makedirs(os.path.join(output_dir, "screenshots"), exist_ok=True)

data_collected = {}

def safe_click(page, selector, section_name, identifier, name):
    try:
        page.locator(selector).nth(0).click(force=True, timeout=2000)
        time.sleep(0.3)
        
        # Capture state
        text = page.locator("body").inner_text()
        html = page.locator("body").inner_html()
        
        scr_path = os.path.join(output_dir, "screenshots", f"{section_name}_{identifier}.png")
        page.screenshot(path=scr_path)
        
        data_collected[name] = {
            "section": section_name,
            "text_snippet": text[:500],
            "html_length": len(html)
        }
        
        with open(os.path.join(output_dir, f"{section_name}_{identifier}.txt"), "w", encoding="utf-8") as f:
            f.write(text)
        with open(os.path.join(output_dir, f"{section_name}_{identifier}.html"), "w", encoding="utf-8") as f:
            f.write(html)
            
    except Exception as e:
        print(f"Error clicking {name} in {section_name}: {e}")

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.set_viewport_size({"width": 1280, "height": 1024})
        
        print("Navigating...")
        page.goto("https://ccunpacked.dev", wait_until="networkidle")
        time.sleep(2)
        
        with open(os.path.join(output_dir, "initial.html"), "w") as f:
            f.write(page.content())
        page.screenshot(path=os.path.join(output_dir, "screenshots", "initial.png"), full_page=True)
        
        # Agent Loop
        print("Processing Agent Loop...")
        labels = page.evaluate("Array.from(document.querySelectorAll('#agent-loop [role=\"button\"]')).map(el => el.getAttribute('aria-label'))")
        for i, label in enumerate(labels):
            if not label: continue
            # scroll to it
            try:
                safe_click(page, f'#agent-loop [aria-label="{label}"]', "agent_loop", i, label)
            except Exception as e:
                print(e)
            
        # Architecture Explorer
        print("Processing Architecture...")
        # Since clicking drills down, let's just get the root labels and attempt to click them. After each, reload.
        labels = page.evaluate("Array.from(document.querySelectorAll('#architecture g[role=\"button\"]')).map(el => el.getAttribute('aria-label'))")
        for i, label in enumerate(labels):
            if not label: continue
            try:
                # Reload to reset tree state
                page.goto("https://ccunpacked.dev", wait_until="networkidle")
                time.sleep(1)
                
                # Check if elements are present again
                page.locator('#architecture g[role="button"]').first.wait_for()
                safe_click(page, f'#architecture g[aria-label="{label}"]', "architecture", i, label)
            except Exception as e:
                print(e)

        # Go back to a clean state
        page.goto("https://ccunpacked.dev", wait_until="networkidle")
        time.sleep(1)
        
        # Tools
        print("Processing Tool System...")
        labels = page.evaluate("Array.from(document.querySelectorAll('#tools button')).map(el => el.getAttribute('aria-label'))")
        for i, label in enumerate(labels):
            if not label: continue
            try:
                safe_click(page, f'#tools button[aria-label="{label}"]', "tools", i, label)
                # clear modal via Escape
                page.keyboard.press("Escape")
                time.sleep(0.2)
            except Exception as e:
                print(e)

        # Commands
        print("Processing Command Catalog...")
        labels = page.evaluate("Array.from(document.querySelectorAll('#commands button')).map(el => el.getAttribute('aria-label'))")
        for i, label in enumerate(labels):
            if not label: continue
            try:
                safe_click(page, f'#commands button[aria-label="{label}"]', "commands", i, label)
                page.keyboard.press("Escape")
                time.sleep(0.1)
            except Exception as e:
                print(e)

        # Hidden Features
        print("Processing Hidden Features...")
        labels = page.evaluate("Array.from(document.querySelectorAll('#hidden-features button')).map(el => el.getAttribute('aria-label'))")
        for i, label in enumerate(labels):
            if not label: continue
            try:
                safe_click(page, f'#hidden-features button[aria-label="{label}"]', "hidden_features", i, label)
                page.keyboard.press("Escape")
                time.sleep(0.1)
            except Exception as e:
                print(e)
            
        with open(os.path.join(output_dir, "summary.json"), "w", encoding="utf-8") as f:
            json.dump(data_collected, f, indent=2)
            
        browser.close()

if __name__ == "__main__":
    run()
    print("Done")
