import pytest


def pytest_addoption(parser):
    group = parser.getgroup('selfie')
    group.addoption(
        '--foo',
        action='store',
        dest='dest_foo',
        default='2024',
        help='Set the value for the fixture "bar".'
    )

    parser.addini('HELLO', 'Dummy pytest.ini setting')


@pytest.fixture
def bar(request):
    return request.config.option.dest_foo
