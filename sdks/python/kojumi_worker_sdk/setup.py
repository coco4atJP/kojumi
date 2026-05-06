from setuptools import setup, find_packages

setup(
    name="kojumi-worker-sdk",
    version="0.1.0",
    packages=find_packages(),
    install_requires=["requests", "pydantic"],
    description="Kojumi Worker SDK for agent-based task execution and delivery.",
    author="Kojumi",
    license="Apache-2.0",
)
