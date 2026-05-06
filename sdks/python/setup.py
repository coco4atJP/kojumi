from setuptools import setup, find_packages

setup(
    name="kojumi-eval-sdk",
    version="0.1.0",
    packages=find_packages(),
    install_requires=["PyJWT", "requests", "pydantic"],
    description="Kojumi Evaluation SDK for generating and submitting JWS attested features.",
    author="Kojumi",
    license="Apache-2.0",
)
