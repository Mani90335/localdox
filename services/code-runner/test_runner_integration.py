"""Opt-in tests against the same restricted containers used by the gateway."""
import json
import os
import unittest
from server import run_container


@unittest.skipUnless(os.environ.get("CODE_STUDIO_DOCKER_TESTS") == "1", "Requires the built Docker image")
class ContainerTests(unittest.TestCase):
    def run_code(self, language, source, stdin=""):
        return json.loads(run_container({"language": language, "source": source, "stdin": stdin}))

    def test_python_recursion_and_input(self):
        result = self.run_code("python", "def fact(n):\n    return n * fact(n-1) if n > 1 else 1\nn = int(input())\nprint(fact(n))", "5\n")
        self.assertEqual(result["steps"][-1]["event"], "end")
        self.assertEqual(result["steps"][-1]["stdout"], "120\n")
        self.assertTrue(any(len(step["frames"]) >= 6 for step in result["steps"]))

    def test_cpp_vector_mutations(self):
        result = self.run_code("cpp", """#include <vector>
#include <iostream>
#include <algorithm>
int main() {
  std::vector<int> values{8, 3};
  values.push_back(5);
  std::swap(values[0], values[1]);
  std::cout << values[0] << ',' << values[1] << ',' << values[2] << '\\n';
  return 0;
}
""")
        self.assertEqual(result["steps"][-1]["event"], "end", result["steps"][-1])
        self.assertEqual(result["steps"][-1]["stdout"], "3,8,5\n")
        self.assertTrue(any("vector" in obj["type"] and len(obj["entries"]) == 3 for step in result["steps"] for obj in step["heap"].values()))

    def test_cpp_pointers_and_cycle(self):
        result = self.run_code("cpp", """#include <iostream>
struct Node { int value; Node* next; };
int main() {
  Node a{10, nullptr};
  Node b{20, &a};
  a.next = &b;
  Node* cursor = &a;
  cursor->value = 7;
  std::cout << a.value << '\\n';
  return 0;
}
""")
        self.assertEqual(result["steps"][-1]["event"], "end", result["steps"][-1])
        self.assertEqual(result["steps"][-1]["stdout"], "7\n")
        self.assertTrue(any(any(isinstance(value, dict) and "ref" in value for _, value in obj["entries"]) for step in result["steps"] for obj in step["heap"].values()))

    def test_cpp_compiler_error(self):
        result = self.run_code("cpp", "int main() { invalid syntax }")
        self.assertEqual(result["steps"][-1]["event"], "error")
        self.assertIn("error", result["steps"][-1]["message"])

    def test_python_step_limit(self):
        result = self.run_code("python", "while True:\n    pass")
        self.assertEqual(result["steps"][-1]["event"], "limit")

    def test_container_has_no_network(self):
        result = self.run_code("python", "import socket\nsocket.create_connection(('1.1.1.1', 443), timeout=1)")
        self.assertEqual(result["steps"][-1]["event"], "error")
        self.assertIn("Network is unreachable", result["steps"][-1]["message"])


if __name__ == "__main__":
    unittest.main()
