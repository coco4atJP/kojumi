import os
import time
import random
import requests
import json
import tempfile
from dotenv import load_dotenv

load_dotenv()
API_URL = os.getenv("KOJUMI_API_URL", "http://localhost:8080")
API_KEY = os.getenv("KOJUMI_API_KEY", "")

def get_headers():
    return {"x-api-key": API_KEY} if API_KEY else {}

def run_worker():
    print("🧪 [TEST/SIMULATION] Starting Mock Benchmark Agent Worker Daemon...")
    print("⚠️  This script is for testing purposes only to simulate agent submissions.")
    
    # 1. Fetch Agents
    try:
        res = requests.get(f"{API_URL}/v1/agents", headers=get_headers())
        res.raise_for_status()
        agents = res.json().get("items", [])
    except Exception as e:
        print(f"❌ Failed to fetch agents: {e}")
        return
    
    if not agents:
        print("⚠️ No agents found. Please register an agent via UI first.")
        return

    while True:
        print("\n🔍 Polling API for benchmark tasks...")
        try:
            res = requests.get(f"{API_URL}/v1/benchmarks", headers=get_headers())
            res.raise_for_status()
            benchmarks = res.json().get("items", [])
        except Exception as e:
            print(f"❌ Failed to fetch benchmarks: {e}")
            time.sleep(10)
            continue
            
        if not benchmarks:
            print("⚠️ No benchmark tasks found.")
            time.sleep(10)
            continue
            
        # Simulate an agent picking up a task
        benchmark = random.choice(benchmarks)
        agent = random.choice(agents)
        
        print(f"  🤖 Agent [{agent['name']}] attempting task [{benchmark['title']}]...")
        
        try:
            # 3.1: Start attempt -> Creates Contract (Platform acts as Requester)
            attempt_res = requests.post(f"{API_URL}/v1/benchmarks/{benchmark['id']}/attempt", headers=get_headers(), json={
                "agent_id": agent['id']
            })
            attempt_res.raise_for_status()
            contract_id = attempt_res.json()["contract_id"]
            
            # 3.2: Create Execution
            exec_res = requests.post(f"{API_URL}/v1/executions", headers=get_headers(), json={
                "contract_id": contract_id,
                "progress": 100
            })
            exec_res.raise_for_status()
            execution_id = exec_res.json()["id"]
            
            # 3.3: Mark Execution Complete
            requests.post(f"{API_URL}/v1/executions/{execution_id}/complete", headers=get_headers()).raise_for_status()
            
            # 3.4: Generate mock result and upload Delivery
            base_competence = min(0.95, (agent.get('basePrice', 10) / 100.0) + 0.5)
            task_metadata = json.loads(benchmark.get('metadataJson') or '{}')
            strategy = task_metadata.get("evaluation_strategy", {})
            
            mock_result = {
                "completed": True,
                "metadata": {
                    "duration_ms": random.randint(5000, 30000),
                    "success_cost": random.uniform(0.01, 1.5),
                    "tool_calls": random.randint(5, 50),
                    "approval_requests": random.choice([0, 0, 0, 1, 2]),
                    "subagent_delegations": random.choice([0, 1, 2])
                }
            }
            
            if strategy.get("type") == "rule_based":
                for rule in strategy.get("rules", []):
                    field = rule.get("field")
                    if random.random() < base_competence + 0.1:
                        if rule.get("type") == "array" or "min_length" in rule:
                            length = rule.get("min_length", 3)
                            mock_result[field] = ["mock_item"] * (length + 1)
                        elif rule.get("type") == "boolean":
                            mock_result[field] = True
                        else:
                            mock_result[field] = "mock_value"
            elif strategy.get("type") == "llm_judge":
                text_length = int(base_competence * 500)
                mock_result["text_output"] = "This is a simulated high-quality response. " * (text_length // 45)
            else:
                 mock_result["accuracy"] = min(1.0, base_competence + random.uniform(-0.2, 0.1))
            
            with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as tmp_file:
                json.dump(mock_result, tmp_file)
                tmp_file_path = tmp_file.name

            with open(tmp_file_path, 'rb') as f:
                del_res = requests.post(f"{API_URL}/v1/deliveries", headers=get_headers(), data={
                    "contract_id": contract_id,
                    "execution_id": execution_id,
                    "summary": "Mock task execution completed by worker daemon."
                }, files={"file": ("result.json", f, "application/json")})
            del_res.raise_for_status()
            os.remove(tmp_file_path)
            
            print(f"     ✅ Delivery submitted for contract {contract_id}")
            
        except Exception as e:
            print(f"     ❌ Simulation failed: {e}")
            
        # Wait a bit before simulating the next agent run
        time.sleep(15)

if __name__ == "__main__":
    run_worker()
