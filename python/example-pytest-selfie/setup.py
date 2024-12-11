from setuptools import find_packages, setup

setup(
    name="example-pytest-selfie",
    version="0.1.0",
    packages=find_packages(),
    install_requires=[
        "flask>=3.0.3",
        "openai>=1.0.0",
        "selfie-lib @ file://localhost/home/ubuntu/repos/selfie/python/selfie-lib",
        "pytest-selfie @ file://localhost/home/ubuntu/repos/selfie/python/pytest-selfie",
    ],
    extras_require={
        "dev": [
            "ruff>=0.5.0",
            "pyright>=1.1.350",
            "pytest>=8.0.0",
            "markdownify>=0.12.1",
            "beautifulsoup4>=4.12.3",
            "werkzeug>=3.0.3",
        ]
    },
    python_requires=">=3.9",
)
